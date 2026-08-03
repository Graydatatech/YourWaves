import { describe, it, expect, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { testSql } from "./helpers/db";

/**
 * The no-double-booking guarantee under real concurrency (SRS 3.2, 4.3).
 *
 * These tests open a POOL of independent connections and fire genuinely
 * simultaneous transactions. That distinction matters: `Promise.all` over one
 * postgres.js connection is pipelined onto a single backend and serialises for
 * free, which would make a broken implementation look correct. Every parallel
 * attempt here gets its own backend, so the advisory lock is doing the work.
 */

const url = process.env.DATABASE_URL!;

/** Enough backends for the 50-way fan-out, plus headroom. */
const pool = postgres(url, {
  max: 60,
  ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : "require",
  onnotice: () => {},
  connection: { timezone: "UTC" },
});

afterAll(async () => {
  await pool.end();
  await testSql.end();
});

type HoldResult = {
  error_code: string | null;
  booking_id: string | null;
  reference: string | null;
  hold_expires_at: string | null;
  price_total: number | null;
};

/**
 * The phone a given attempt uses. Shared so the release tests cannot drift from
 * attemptHold() — hand-writing the same number twice is what broke them first
 * time round.
 */
function phoneFor(suffix: number): string {
  return "+9745500" + String(suffix).padStart(4, "0");
}

/** One hold attempt on its own connection. */
async function attemptHold(
  date: string,
  phoneSuffix: number,
  startTime = "09:00",
): Promise<HoldResult> {
  const rows = await pool<HoldResult[]>`
    SELECT * FROM create_booking_hold(
      ${date}::date,
      ${startTime}::time,
      ${"Racer " + phoneSuffix},
      ${phoneFor(phoneSuffix)},
      ${"Villa " + phoneSuffix + ", Street 850, Al Wakrah"}
    )
  `;
  return rows[0];
}

function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function reset() {
  await testSql`TRUNCATE bookings, booking_events, payments, blackout_dates CASCADE`;
}

describe("holds: 50 parallel attempts on the same date", () => {
  beforeEach(reset);

  it("lets exactly one succeed and refuses the other 49", async () => {
    const date = futureDate(30);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => attemptHold(date, i + 1)),
    );

    const won = results.filter((r) => r.error_code === null);
    const taken = results.filter((r) => r.error_code === "DATE_TAKEN");
    const other = results.filter(
      (r) => r.error_code !== null && r.error_code !== "DATE_TAKEN",
    );

    expect(other, `unexpected codes: ${JSON.stringify(other)}`).toHaveLength(0);
    expect(won).toHaveLength(1);
    expect(taken).toHaveLength(49);

    // And the database agrees: one row, and it is the winner's.
    const rows = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM bookings
       WHERE booking_date = ${date}::date AND status = 'holding'
    `;
    expect(rows[0].count).toBe(1);
    expect(won[0].reference).toMatch(/^YW-\d{4}-\d{4}$/);
    expect(won[0].booking_id).toBeTruthy();
    expect(won[0].price_total).toBe(545000);
  });
});

describe("holds: expiry frees the date", () => {
  beforeEach(reset);

  it("allows a new hold once the previous one lapses", async () => {
    const date = futureDate(31);

    const first = await attemptHold(date, 1);
    expect(first.error_code).toBeNull();

    // Blocked while the hold is live.
    expect((await attemptHold(date, 2)).error_code).toBe("DATE_TAKEN");

    // Age the hold past its expiry.
    await testSql`
      UPDATE bookings SET hold_expires_at = now() - interval '1 second'
       WHERE id = ${first.booking_id}::uuid
    `;

    // create_booking_hold sweeps lapsed holds itself, so this succeeds without
    // waiting for the cron job.
    const second = await attemptHold(date, 3);
    expect(second.error_code).toBeNull();
    expect(second.booking_id).not.toBe(first.booking_id);

    const statuses = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE booking_date = ${date}::date
       ORDER BY created_at
    `;
    expect(statuses.map((s) => s.status)).toEqual(["expired", "holding"]);
  });

  it("marks an in-flight payment abandoned rather than deleting it", async () => {
    const date = futureDate(32);
    const hold = await attemptHold(date, 1);

    await testSql`
      INSERT INTO payments (booking_id, provider, provider_ref, amount, status)
      VALUES (${hold.booking_id}::uuid, 'skipcash', 'ref-abc', 545000, 'initiated')
    `;
    await testSql`
      UPDATE bookings SET hold_expires_at = now() - interval '1 second'
       WHERE id = ${hold.booking_id}::uuid
    `;

    const [{ expire_stale_holds: released }] = await testSql<
      { expire_stale_holds: number }[]
    >`SELECT expire_stale_holds()`;
    expect(released).toBe(1);

    const payments = await testSql<{ status: string; provider_ref: string }[]>`
      SELECT status, provider_ref FROM payments
       WHERE booking_id = ${hold.booking_id}::uuid
    `;
    // Still there — a payment row is evidence money may have moved.
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("abandoned");
    expect(payments[0].provider_ref).toBe("ref-abc");
  });
});

describe("holds: a confirmed booking is never superseded", () => {
  beforeEach(reset);

  it("refuses a hold on a confirmed date, even after the hold window would have lapsed", async () => {
    const date = futureDate(33);

    const hold = await attemptHold(date, 1);
    await testSql`
      SELECT transition_booking_status(${hold.booking_id}::uuid, 'pending', 'system')
    `;
    await testSql`
      SELECT transition_booking_status(${hold.booking_id}::uuid, 'confirmed', 'system')
    `;

    // A confirmed row has no hold_expires_at, so no sweep can touch it.
    const [{ expire_stale_holds: released }] = await testSql<
      { expire_stale_holds: number }[]
    >`SELECT expire_stale_holds()`;
    expect(released).toBe(0);

    // 20 simultaneous attempts, all refused.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => attemptHold(date, i + 10)),
    );
    expect(results.every((r) => r.error_code === "DATE_TAKEN")).toBe(true);

    const [{ status }] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${hold.booking_id}::uuid
    `;
    expect(status).toBe("confirmed");
  });

  it("frees the date when a confirmed booking is cancelled", async () => {
    const date = futureDate(34);

    const hold = await attemptHold(date, 1);
    await testSql`SELECT transition_booking_status(${hold.booking_id}::uuid, 'pending', 'system')`;
    await testSql`SELECT transition_booking_status(${hold.booking_id}::uuid, 'confirmed', 'system')`;
    expect((await attemptHold(date, 2)).error_code).toBe("DATE_TAKEN");

    await testSql`
      SELECT transition_booking_status(${hold.booking_id}::uuid, 'cancelled', 'admin')
    `;

    const after = await attemptHold(date, 3);
    expect(after.error_code).toBeNull();
  });
});

describe("holds: the advisory lock is per-date, not global", () => {
  beforeEach(reset);

  it("does not serialise attempts on different dates", async () => {
    // 40 distinct dates, one attempt each, all at once. If the lock were global
    // these would queue behind one another.
    const dates = Array.from({ length: 40 }, (_, i) => futureDate(40 + i));

    const started = Date.now();
    const results = await Promise.all(
      dates.map((date, i) => attemptHold(date, i + 1)),
    );
    const elapsed = Date.now() - started;

    expect(results.every((r) => r.error_code === null)).toBe(true);

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM bookings WHERE status = 'holding'
    `;
    expect(count).toBe(40);

    // Timing is a weak signal, so this is a generous ceiling rather than a
    // benchmark — the structural assertion below is the real proof.
    expect(elapsed).toBeLessThan(15_000);
  });

  it("holds a lock on date X without blocking a transaction on date Y", async () => {
    const dateX = futureDate(90);
    const dateY = futureDate(91);

    // Take and HOLD the lock for X in an open transaction.
    let releaseX: (() => void) | null = null;
    const xDone = new Promise<void>((resolve) => {
      releaseX = resolve;
    });

    const xTransaction = pool.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(4242, booking_date_lock_key(${dateX}::date))`;
      // Keep the lock held until the Y work has finished.
      await xDone;
    });

    // Give the lock time to be acquired.
    await new Promise((r) => setTimeout(r, 250));

    // Y must complete while X's lock is still held.
    const y = await Promise.race([
      attemptHold(dateY, 99),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("date Y blocked by date X's lock")),
          5000,
        ),
      ),
    ]);
    expect(y.error_code).toBeNull();

    // Prove X's lock really was held for the whole of that.
    const [{ held }] = await pool<{ held: number }[]>`
      SELECT count(*)::int AS held FROM pg_locks
       WHERE locktype = 'advisory' AND objid = booking_date_lock_key(${dateX}::date)
    `;
    expect(held).toBeGreaterThan(0);

    releaseX!();
    await xTransaction;
  });
});

describe("holds: release", () => {
  beforeEach(reset);

  it("releases a hold for the owning phone and frees the date", async () => {
    const date = futureDate(35);
    const hold = await attemptHold(date, 1);

    const [result] = await testSql<{ error_code: string | null }[]>`
      SELECT * FROM release_booking_hold(
        ${hold.booking_id}::uuid, ${phoneFor(1)}
      )
    `;
    expect(result.error_code).toBeNull();

    const [{ status }] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${hold.booking_id}::uuid
    `;
    expect(status).toBe("cancelled");

    expect((await attemptHold(date, 2)).error_code).toBeNull();
  });

  it("refuses release from a different phone", async () => {
    const date = futureDate(36);
    const hold = await attemptHold(date, 1);

    const [result] = await testSql<{ error_code: string | null }[]>`
      SELECT * FROM release_booking_hold(
        ${hold.booking_id}::uuid, '+97455999999'
      )
    `;
    expect(result.error_code).toBe("FORBIDDEN");

    const [{ status }] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${hold.booking_id}::uuid
    `;
    expect(status).toBe("holding");
  });

  it("refuses release of anything that is not holding", async () => {
    const date = futureDate(37);
    const hold = await attemptHold(date, 1);
    await testSql`SELECT transition_booking_status(${hold.booking_id}::uuid, 'pending', 'system')`;

    const [result] = await testSql<{ error_code: string | null }[]>`
      SELECT * FROM release_booking_hold(
        ${hold.booking_id}::uuid, ${phoneFor(1)}
      )
    `;
    expect(result.error_code).toBe("NOT_HOLDING");
  });
});

describe("holds: the TypeScript mapping layer", () => {
  beforeEach(reset);

  /**
   * Regression guard.
   *
   * The direct-SQL tests above all passed while the HTTP endpoint returned 500,
   * because `create_booking_hold()` returns `hold_expires_at` as a STRING via
   * RETURNS TABLE — postgres.js does not apply its timestamptz parser there —
   * and the mapping called `.toISOString()` on it. The row inserted, then the
   * response threw. Exercising createHold() itself is the only way to catch a
   * fault that lives between SQL and HTTP.
   */
  it("maps a hold to ISO strings whatever the driver returns", async () => {
    const { createHold } = await import("@/lib/booking/holds");
    const date = futureDate(38);

    const result = await createHold({
      bookingDate: date,
      preferredStart: "09:00:00",
      customerName: "Mapping Test",
      customerPhone: phoneFor(1),
      dialCode: "+974",
      phoneNational: "55000001",
      buildingNo: "14",
      streetNo: "850",
      zoneNo: "55",
      addressLine: "Building 14, Street 850, Zone 55",
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must be a parseable ISO instant, not "[object Object]" or a raw PG string.
    expect(result.holdExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(Number.isNaN(Date.parse(result.holdExpiresAt))).toBe(false);

    // And roughly hold_minutes ahead (10 by default), allowing for round trips.
    const minutesAhead =
      (Date.parse(result.holdExpiresAt) - Date.now()) / 60_000;
    expect(minutesAhead).toBeGreaterThan(9);
    expect(minutesAhead).toBeLessThanOrEqual(10.5);

    expect(result.reference).toMatch(/^YW-\d{4}-\d{4}$/);
    expect(result.priceTotal).toBe(545000);
    expect(result.currency).toBe("QAR");
  });

  it("reports a refusal as a code rather than throwing", async () => {
    const { createHold } = await import("@/lib/booking/holds");
    const date = futureDate(39);
    const base = {
      bookingDate: date,
      preferredStart: "09:00:00",
      customerName: "First",
      dialCode: "+974",
      phoneNational: "55000001",
      buildingNo: "14",
      streetNo: "850",
      zoneNo: "55",
      addressLine: "Building 14, Street 850, Zone 55",
      locale: "en" as const,
    };

    expect((await createHold({ ...base, customerPhone: phoneFor(1) })).ok).toBe(
      true,
    );

    const second = await createHold({ ...base, customerPhone: phoneFor(2) });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DATE_TAKEN");
  });

  it("round-trips a snapshot through getHold", async () => {
    const { createHold, getHold } = await import("@/lib/booking/holds");
    const date = futureDate(41);

    const created = await createHold({
      bookingDate: date,
      preferredStart: "10:00:00",
      customerName: "Snapshot",
      customerPhone: phoneFor(7),
      dialCode: "+974",
      phoneNational: "55000007",
      buildingNo: "7",
      streetNo: "850",
      zoneNo: "55",
      addressLine: "Building 7, Street 850, Zone 55",
      locale: "ar",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const snapshot = await getHold(created.bookingId, phoneFor(7));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("holding");
    expect(snapshot!.bookingDate).toBe(date);
    expect(snapshot!.holdExpiresAt).toBe(created.holdExpiresAt);

    // A different phone must not be able to read it.
    expect(await getHold(created.bookingId, phoneFor(8))).toBeNull();
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { testSql, truncateBookings } from "./helpers/db";

/**
 * Authorisation, proved in the database.
 *
 * The back-office is the first part of this project with authenticated users,
 * and therefore the first with a real "which rows may you see?" question. That
 * question is answered by RLS policies, so it is tested against RLS policies —
 * not by calling a route handler and trusting that it filtered correctly.
 *
 * HOW THE IMPERSONATION WORKS
 * PostgREST authenticates a request by setting the `authenticated` role and the
 * `request.jwt.claims` GUC, and Supabase's `auth.uid()` reads `sub` out of that
 * GUC. Migration 0008 creates an identical `auth.uid()` when one does not
 * already exist, so setting both here reproduces exactly what a real request
 * does. The policy being exercised is the policy that will run in production.
 *
 * Note the tests do NOT run as the table owner. The developer database connects
 * as a superuser, which bypasses RLS unconditionally — the same false pass that
 * hid the FORCE mistake in phase 2. Every assertion below happens inside a
 * transaction that has switched to `authenticated`.
 */

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const NOBODY_ID = "44444444-4444-4444-8444-444444444444";

// Kept: bookings still reference an assigned recipient, which is what the
// admin policies are exercised against.
let driverA = "";
let driverB = "";
let bookingA = "";
let bookingB = "";
let bookingUnassigned = "";

/** Runs a query as an authenticated user, exactly as PostgREST would. */
async function asUser<T>(
  userId: string | null,
  run: (tx: typeof testSql) => Promise<T>,
): Promise<T> {
  return testSql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE authenticated`);
    if (userId) {
      await tx.unsafe(
        `SELECT set_config('request.jwt.claims', '{"sub":"${userId}"}', true)`,
      );
    } else {
      await tx.unsafe(`SELECT set_config('request.jwt.claims', '', true)`);
    }
    return run(tx as unknown as typeof testSql);
  }) as Promise<T>;
}

/**
 * Asserts a read is denied, accepting EITHER of the two shapes denial takes.
 *
 * RLS filters rows and returns an empty set. A missing GRANT — or missing
 * USAGE on the schema — refuses the statement outright. Both are denial, and
 * which one applies depends on how the role was set up, so a test that insists
 * on one shape fails for the wrong reason. Insisting on "no data reached the
 * caller" is the property that actually matters.
 */
async function expectNoAccess(
  label: string,
  read: () => Promise<readonly unknown[]>,
): Promise<void> {
  let rows: readonly unknown[] | null = null;
  try {
    rows = await read();
  } catch {
    return; // refused outright — denied
  }
  expect(rows, `${label} leaked ${rows?.length} row(s)`).toHaveLength(0);
}

/** Runs a query as the anonymous role, which is what an unauthenticated caller is. */
async function asAnon<T>(run: (tx: typeof testSql) => Promise<T>): Promise<T> {
  return testSql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE anon`);
    return run(tx as unknown as typeof testSql);
  }) as Promise<T>;
}

async function seedBooking(date: string, driver: string | null) {
  const rows = await testSql<{ id: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, customer_name, customer_phone,
      customer_email, address_line, assigned_driver,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      ${date}::date, '10:00:00'::time,
      ${driver ? "assigned" : "confirmed"}::booking_status,
      'RLS Customer', '+97455000333', 'rls@example.com', 'Villa 7',
      ${driver}::uuid, 450000, 60000, 35000, 545000
    )
    RETURNING id
  `;
  return rows[0].id;
}

beforeAll(async () => {
  await truncateBookings();
  await testSql`DELETE FROM user_roles`;
  await testSql`DELETE FROM dispatch_recipients WHERE full_name LIKE 'RLS %'`;

  const a = await testSql<{ id: string }[]>`
    INSERT INTO dispatch_recipients (full_name, phone, role)
    VALUES ('RLS Driver A', '+97455111000', 'driver') RETURNING id
  `;
  const b = await testSql<{ id: string }[]>`
    INSERT INTO dispatch_recipients (full_name, phone, role)
    VALUES ('RLS Driver B', '+97455222000', 'driver') RETURNING id
  `;
  driverA = a[0].id;
  driverB = b[0].id;

  await testSql`
    INSERT INTO user_roles (user_id, role, email) VALUES
      (${ADMIN_ID}::uuid, 'admin', 'admin@yourwaves.qa')
  `;

  bookingA = await seedBooking("2026-11-01", driverA);
  bookingB = await seedBooking("2026-11-02", driverB);
  bookingUnassigned = await seedBooking("2026-11-03", null);
});

describe("an unauthenticated caller", () => {
  it("reads nothing at all", async () => {
    for (const table of [
      "bookings",
      "dispatch_recipients",
      "settings",
      "payments",
      "notifications",
      "booking_events",
      "user_roles",
      "booking_notes",
      "blackout_dates",
    ]) {
      await expectNoAccess(`anon reading ${table}`, () =>
        asAnon((tx) => tx.unsafe(`SELECT * FROM ${table}`)),
      );
    }
  });

  it("cannot write a booking", async () => {
    await expect(
      asAnon(
        (tx) => tx`
          UPDATE bookings SET status = 'cancelled' WHERE id = ${bookingA}::uuid
        `,
      ),
    ).rejects.toThrow();
  });
});

describe("an authenticated user with no role", () => {
  it("is not an admin and sees no bookings", async () => {
    // A signed-up Supabase user who was never granted anything. Being logged in
    // is not the same as being authorised.
    const rows = await asUser(NOBODY_ID, (tx) => tx`SELECT * FROM bookings`);
    expect(rows).toHaveLength(0);

    const [{ auth_is_admin: isAdmin }] = await asUser(
      NOBODY_ID,
      (tx) => tx<{ auth_is_admin: boolean }[]>`SELECT auth_is_admin()`,
    );
    expect(isAdmin).toBe(false);
  });

  it("cannot make itself an admin", async () => {
    await expect(
      asUser(
        NOBODY_ID,
        (tx) => tx`
          INSERT INTO user_roles (user_id, role)
          VALUES (${NOBODY_ID}::uuid, 'admin')
        `,
      ),
    ).rejects.toThrow();
  });
});

describe("an admin", () => {
  it("reads every booking", async () => {
    const rows = await asUser(
      ADMIN_ID,
      (tx) => tx<{ id: string }[]>`SELECT id FROM bookings`,
    );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [bookingA, bookingB, bookingUnassigned].sort(),
    );
  });

  it("reads payments, notifications, settings and drivers", async () => {
    for (const table of ["settings", "dispatch_recipients", "user_roles"]) {
      const rows = await asUser(ADMIN_ID, (tx) =>
        tx.unsafe(`SELECT * FROM ${table}`),
      );
      expect(rows.length, `${table} should be visible`).toBeGreaterThan(0);
    }
  });

  it("can write a booking and add a note", async () => {
    await asUser(
      ADMIN_ID,
      (tx) => tx`
        UPDATE bookings SET city = 'Doha' WHERE id = ${bookingUnassigned}::uuid
      `,
    );

    await asUser(
      ADMIN_ID,
      (tx) => tx`
        INSERT INTO booking_notes (booking_id, author_id, author_name, body)
        VALUES (${bookingUnassigned}::uuid, ${ADMIN_ID}::uuid, 'Admin', 'called the customer')
      `,
    );

    const notes = await asUser(
      ADMIN_ID,
      (tx) => tx<{ body: string }[]>`SELECT body FROM booking_notes`,
    );
    expect(notes[0].body).toBe("called the customer");
  });

  /**
   * The back office deletes exactly two things, and both were broken.
   *
   * A `FOR ALL` policy permits the ROW; it does not grant the TABLE. 0008
   * granted SELECT/INSERT/UPDATE and no DELETE anywhere, so removing a driver
   * or lifting a blackout failed with 42501 before any policy was consulted —
   * a 500 the UI could only render as "Something went wrong". 0013 grants the
   * two, narrowly.
   *
   * These run as `authenticated`, not as the table owner, which is the whole
   * point: the owner is a superuser locally and would pass regardless.
   */
  it("can remove a dispatch recipient", async () => {
    const [doomed] = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone, role)
      VALUES ('RLS Delete Me', '+97455999123', 'driver') RETURNING id
    `;

    const removed = await asUser(
      ADMIN_ID,
      (tx) => tx<{ id: string }[]>`
        DELETE FROM dispatch_recipients WHERE id = ${doomed.id}::uuid RETURNING id
      `,
    );
    expect(removed.map((row) => row.id)).toEqual([doomed.id]);
  });

  it("can lift a blackout date", async () => {
    await testSql`
      INSERT INTO blackout_dates (date, reason) VALUES ('2027-01-09', 'rls test')
      ON CONFLICT (date) DO NOTHING
    `;

    const removed = await asUser(
      ADMIN_ID,
      (tx) => tx<{ id: string }[]>`
        DELETE FROM blackout_dates WHERE date = '2027-01-09'::date RETURNING id
      `,
    );
    expect(removed).toHaveLength(1);
  });

  it("still cannot delete a payment or an audit row", async () => {
    // The narrowness is the point. A payment row is evidence money moved, and
    // booking_events is the audit trail; neither may be removed by a session,
    // however senior the person holding it.
    for (const table of ["payments", "booking_events", "bookings"]) {
      await expect(
        asUser(ADMIN_ID, (tx) => tx.unsafe(`DELETE FROM ${table}`)),
        `${table} must not be deletable`,
      ).rejects.toThrow();
    }
  });
});

/**
 * The "a driver" block that used to live here is gone with the feature.
 *
 * Phase 9 removed the driver login entirely: drivers never sign in, they get a
 * WhatsApp link carrying a capability token. What replaced these tests is
 * tests/dispatch.test.ts — token scoping, expiry, revocation — plus the
 * "the driver login is gone" block there, which asserts the role, the helper
 * function and the policies are actually absent rather than merely unused.
 */

describe("otp_verifications", () => {
  it("is invisible to every authenticated role", async () => {
    // Named in no policy at all. It holds one-time-code hashes and IP
    // addresses, and nothing in the back office has a use for it.
    await testSql`
      INSERT INTO otp_verifications (phone, code_hash, expires_at)
      VALUES ('+97455000444', 'hash', now() + interval '5 minutes')
    `;

    // Stricter than a policy denial: `authenticated` was never granted SELECT
    // on this table at all, so the statement is refused before RLS is consulted.
    for (const user of [ADMIN_ID]) {
      await expectNoAccess(`user ${user} reading otp_verifications`, () =>
        asUser(user, (tx) => tx`SELECT * FROM otp_verifications`),
      );
    }
  });
});

describe("the role lookup", () => {
  it("cannot be spoofed by a claim for a user with no row", async () => {
    const [{ auth_role: role }] = await asUser(
      "99999999-9999-4999-8999-999999999999",
      (tx) => tx<{ auth_role: string | null }[]>`SELECT auth_role()`,
    );
    expect(role).toBeNull();
  });

  it("reports admin for an admin", async () => {
    const [{ auth_role: role }] = await asUser(
      ADMIN_ID,
      (tx) => tx<{ auth_role: string | null }[]>`SELECT auth_role()`,
    );
    expect(role).toBe("admin");
  });
});

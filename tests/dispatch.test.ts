import { beforeEach, describe, expect, it } from "vitest";
import { testSql, truncateBookings } from "./helpers/db";
import { hashDispatchToken } from "@/lib/dispatch/token";
import { resolveDispatchToken } from "@/lib/dispatch/service";
import { storeDispatchPhoto } from "@/lib/dispatch/photos";
import { applyDispatchAction } from "@/lib/dispatch/actions";
import { PHOTO_MAX_BYTES } from "@/lib/dispatch/photoLimits";

/**
 * The dispatch link is the only thing standing between a stranger and a
 * customer's home address. There is no login behind it — the token IS the
 * authorisation — so these tests are mostly about what must NOT work.
 *
 * They run against the real SQL functions and the real tables, because that is
 * where the guarantees live: minting, expiry, revocation and the state machine
 * are all enforced by the database, not by the route handler.
 */

const DRIVER = "+97455700001";
const OWNER = "+97455700002";
const OUTSIDER = "+97455700003";

async function seedRecipients() {
  await testSql`DELETE FROM dispatch_recipients`;
  await testSql`
    INSERT INTO dispatch_recipients (full_name, phone, role, is_default) VALUES
      ('Dispatch Driver', ${DRIVER}, 'driver', true),
      ('Dispatch Owner',  ${OWNER},  'owner',  true),
      ('Not Default',     ${OUTSIDER}, 'other', false)
  `;
}

async function seedBooking(date: string, status = "holding") {
  const rows = await testSql<{ id: string; reference: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, hold_expires_at,
      customer_name, customer_phone, address_line, area, locale,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      ${date}::date, '10:00:00'::time, ${status}::booking_status,
      ${status === "holding" ? testSql`now() + interval '10 minutes'` : null},
      'Dispatch Customer', '+97455000900', 'Villa 21, Street 900', 'Al Waab', 'ar',
      450000, 60000, 35000, 545000
    )
    RETURNING id, reference
  `;
  return rows[0];
}

/** What the payment webhook does: holding → confirmed. */
async function confirm(bookingId: string) {
  await testSql`
    UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL
     WHERE id = ${bookingId}::uuid
  `;
}

/** The raw token for one recipient, read out of the queued WhatsApp message. */
async function tokenFor(bookingId: string, phone: string): Promise<string> {
  const rows = await testSql<{ token: string }[]>`
    SELECT payload->>'dispatch_token' AS token FROM notifications
     WHERE booking_id = ${bookingId}::uuid
       AND template_key = 'dispatch_job' AND recipient = ${phone}
  `;
  return rows[0].token;
}

/**
 * Resolves a real token exactly as the route does, so tests that exercise the
 * endpoint's own code get the endpoint's own job object rather than a fixture
 * shaped like one — the §4e lesson about direct-SQL tests not being sufficient.
 */
async function jobFor(bookingId: string, phone: string) {
  const result = await resolveDispatchToken(
    await tokenFor(bookingId, phone),
    { ip: null, userAgent: "vitest" },
    { markOpened: false },
  );
  if (!result.ok) throw new Error(`token refused: ${result.reason}`);
  return result.job;
}

beforeEach(async () => {
  await truncateBookings();
  await testSql`DELETE FROM dispatch_access_log`;
  await seedRecipients();
});

describe("a confirmed payment dispatches to every default recipient, exactly once", () => {
  it("sends to the defaults and nobody else", async () => {
    const booking = await seedBooking("2026-11-10");
    await confirm(booking.id);

    const rows = await testSql<{ phone: string }[]>`
      SELECT phone FROM booking_dispatch WHERE booking_id = ${booking.id}::uuid
       ORDER BY phone
    `;
    expect(rows.map((row) => row.phone)).toEqual([DRIVER, OWNER]);
  });

  it("queues exactly one WhatsApp message per recipient", async () => {
    const booking = await seedBooking("2026-11-11");
    await confirm(booking.id);

    const rows = await testSql<{ recipient: string; count: number }[]>`
      SELECT recipient, count(*)::int AS count FROM notifications
       WHERE booking_id = ${booking.id}::uuid AND template_key = 'dispatch_job'
       GROUP BY recipient ORDER BY recipient
    `;
    expect(rows).toEqual([
      { recipient: DRIVER, count: 1 },
      { recipient: OWNER, count: 1 },
    ]);
  });

  it("does not mint a second token if the fan-out runs again", async () => {
    // The status trigger and an admin action can both ask. Neither may leave a
    // recipient holding two live links.
    const booking = await seedBooking("2026-11-12");
    await confirm(booking.id);

    const before = await testSql<{ token_hash: string }[]>`
      SELECT token_hash FROM booking_dispatch WHERE booking_id = ${booking.id}::uuid
       ORDER BY phone
    `;

    await testSql`SELECT dispatch_default_recipients(${booking.id}::uuid)`;

    const after = await testSql<{ token_hash: string }[]>`
      SELECT token_hash FROM booking_dispatch WHERE booking_id = ${booking.id}::uuid
       ORDER BY phone
    `;
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
  });
});

describe("two recipients on the same booking", () => {
  it("each get a distinct token", async () => {
    const booking = await seedBooking("2026-11-13");
    await confirm(booking.id);

    const driverToken = await tokenFor(booking.id, DRIVER);
    const ownerToken = await tokenFor(booking.id, OWNER);

    expect(driverToken).not.toBe(ownerToken);
    expect(driverToken.length).toBeGreaterThanOrEqual(40);

    // And the stored hash is the hash of the raw token — the same function
    // Node uses to verify it on every page open.
    const [row] = await testSql<{ token_hash: string }[]>`
      SELECT token_hash FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid AND phone = ${DRIVER}
    `;
    expect(row.token_hash).toBe(hashDispatchToken(driverToken));
  });

  it("revoking one leaves the other working", async () => {
    const booking = await seedBooking("2026-11-14");
    await confirm(booking.id);

    await testSql`
      UPDATE booking_dispatch SET revoked_at = now()
       WHERE booking_id = ${booking.id}::uuid AND phone = ${OWNER}
    `;

    const rows = await testSql<{ phone: string; revoked_at: string | null }[]>`
      SELECT phone, revoked_at FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid ORDER BY phone
    `;
    expect(rows.find((row) => row.phone === OWNER)!.revoked_at).not.toBeNull();
    expect(rows.find((row) => row.phone === DRIVER)!.revoked_at).toBeNull();
  });

  it("deactivating a recipient revokes only their links", async () => {
    const booking = await seedBooking("2026-11-15");
    await confirm(booking.id);

    await testSql`
      UPDATE dispatch_recipients SET is_active = false WHERE phone = ${OWNER}
    `;

    const rows = await testSql<{ phone: string; revoked_at: string | null }[]>`
      SELECT phone, revoked_at FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid ORDER BY phone
    `;
    expect(rows.find((row) => row.phone === OWNER)!.revoked_at).not.toBeNull();
    expect(rows.find((row) => row.phone === DRIVER)!.revoked_at).toBeNull();
  });
});

describe("a token is scoped to one booking", () => {
  it("cannot be used to read another", async () => {
    const a = await seedBooking("2026-11-16");
    const b = await seedBooking("2026-11-17");
    await confirm(a.id);
    await confirm(b.id);

    const tokenA = await tokenFor(a.id, DRIVER);

    // The lookup is by hash and returns the booking joined to THAT row. There
    // is no query shape in which a token reaches a second booking.
    const rows = await testSql<{ booking_id: string }[]>`
      SELECT booking_id FROM booking_dispatch
       WHERE token_hash = ${hashDispatchToken(tokenA)}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].booking_id).toBe(a.id);
    expect(rows[0].booking_id).not.toBe(b.id);
  });

  it("a tampered token matches nothing", async () => {
    const booking = await seedBooking("2026-11-18");
    await confirm(booking.id);
    const token = await tokenFor(booking.id, DRIVER);

    // One character changed. The hash is unrecognisable, so the lookup misses —
    // there is no partial match and no prefix scan to exploit.
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`;
    const rows = await testSql`
      SELECT id FROM booking_dispatch WHERE token_hash = ${hashDispatchToken(tampered)}
    `;
    expect(rows).toHaveLength(0);
  });
});

describe("expiry", () => {
  it("is the end of the booking day plus 24 hours, in Qatar", async () => {
    const booking = await seedBooking("2026-11-19");
    await confirm(booking.id);

    const [row] = await testSql<{ local: string }[]>`
      SELECT to_char(token_expires_at AT TIME ZONE 'Asia/Qatar', 'YYYY-MM-DD HH24:MI') AS local
        FROM booking_dispatch WHERE booking_id = ${booking.id}::uuid LIMIT 1
    `;
    // Midnight at the START of the 21st is midnight at the END of the 20th,
    // which is the booking day plus one full extra day.
    expect(row.local).toBe("2026-11-21 00:00");
  });

  it("does not depend on when the booking was made", async () => {
    // A job booked months ahead must not carry a link that is live for months.
    const near = await seedBooking("2026-11-20");
    const far = await seedBooking("2027-06-01");
    await confirm(near.id);
    await confirm(far.id);

    const rows = await testSql<{ booking_id: string; local: string }[]>`
      SELECT booking_id,
             to_char(token_expires_at AT TIME ZONE 'Asia/Qatar', 'YYYY-MM-DD') AS local
        FROM booking_dispatch WHERE phone = ${DRIVER}
    `;
    expect(rows.find((row) => row.booking_id === near.id)!.local).toBe(
      "2026-11-22",
    );
    expect(rows.find((row) => row.booking_id === far.id)!.local).toBe(
      "2027-06-03",
    );
  });
});

describe("cancelling a booking", () => {
  it("revokes every live link to that customer's address", async () => {
    const booking = await seedBooking("2026-11-21");
    await confirm(booking.id);

    await testSql`
      SELECT transition_booking_status(
        ${booking.id}::uuid, 'cancelled', 'admin', 'test', '{}'::jsonb)
    `;

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid AND revoked_at IS NULL
    `;
    expect(count).toBe(0);
  });
});

describe("reassignment", () => {
  it("kills the outgoing driver's link and gives the new one their own", async () => {
    const booking = await seedBooking("2026-11-22");
    await confirm(booking.id);

    const [first] = await testSql<{ id: string }[]>`
      SELECT id FROM dispatch_recipients WHERE phone = ${DRIVER}
    `;
    const [second] = await testSql<{ id: string }[]>`
      SELECT id FROM dispatch_recipients WHERE phone = ${OUTSIDER}
    `;

    await testSql`SELECT * FROM assign_driver(${booking.id}::uuid, ${first.id}::uuid, 'test')`;
    await testSql`SELECT * FROM assign_driver(${booking.id}::uuid, ${second.id}::uuid, 'test')`;

    const rows = await testSql<{ phone: string; revoked_at: string | null }[]>`
      SELECT phone, revoked_at FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid ORDER BY phone
    `;

    // The replaced driver is no longer entitled to the address.
    expect(rows.find((row) => row.phone === DRIVER)!.revoked_at).not.toBeNull();
    // The new one has a live link of their own.
    expect(rows.find((row) => row.phone === OUTSIDER)!.revoked_at).toBeNull();
  });
});

describe("the state machine still governs a valid token", () => {
  it("refuses a jump the machine does not allow", async () => {
    const booking = await seedBooking("2026-11-23");
    await confirm(booking.id);

    // confirmed → completed is not legal; a valid token does not change that.
    await expect(
      testSql`
        SELECT transition_booking_status(
          ${booking.id}::uuid, 'completed', 'driver', 'tester', '{}'::jsonb)
      `,
    ).rejects.toThrow(/illegal_transition/);

    const [row] = await testSql<{ status: string }[]>`
      SELECT status::text FROM bookings WHERE id = ${booking.id}::uuid
    `;
    expect(row.status).toBe("confirmed");
  });

  it("refuses an action the machine has no path for, through the real endpoint code", async () => {
    // "Job complete" straight from confirmed. There is no walk for this and
    // there should not be — the crew cannot finish a job they never started.
    const booking = await seedBooking("2026-12-01");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    const result = await applyDispatchAction(
      job,
      "job_complete",
      "tap-illegal",
    );
    expect(result.outcome).toBe("illegal_transition");
    expect(result.status).toBe("confirmed");

    const [row] = await testSql<{ status: string }[]>`
      SELECT status::text FROM bookings WHERE id = ${booking.id}::uuid
    `;
    expect(row.status).toBe("confirmed");
  });
});

describe("'on my way' before anyone has been assigned in the back office", () => {
  /**
   * The automatic dispatch fires on payment, long before an admin opens the
   * dashboard, so this is the NORMAL case rather than an edge one: the button
   * the job sheet draws must actually work against a `confirmed` booking.
   */
  it("walks confirmed → assigned → en_route in one tap", async () => {
    const booking = await seedBooking("2026-12-02");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    const result = await applyDispatchAction(
      job,
      "on_my_way",
      "tap-self-assign",
    );
    expect(result).toEqual({ outcome: "applied", status: "en_route" });

    const events = await testSql<{ to_status: string; actor_id: string }[]>`
      SELECT to_status::text, actor_id FROM booking_events
       WHERE booking_id = ${booking.id}::uuid
         AND to_status IN ('assigned', 'en_route')
       ORDER BY created_at
    `;
    expect(events.map((event) => event.to_status)).toEqual([
      "assigned",
      "en_route",
    ]);
    // Both steps are attributed to the phone that pressed the button, not to
    // an admin who was not involved.
    expect(events.every((event) => event.actor_id.includes(DRIVER))).toBe(true);
  });

  it("does not put anyone's name on the booking", async () => {
    // Taking the job is not the office deciding who is driving, and a driver
    // assignment here would message the person already holding the phone.
    const booking = await seedBooking("2026-12-03");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    await applyDispatchAction(job, "on_my_way", "tap-no-assign");

    const [row] = await testSql<{ assigned_driver: string | null }[]>`
      SELECT assigned_driver FROM bookings WHERE id = ${booking.id}::uuid
    `;
    expect(row.assigned_driver).toBeNull();

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
       WHERE booking_id = ${booking.id}::uuid
         AND template_key = 'driver_assignment'
    `;
    expect(count).toBe(0);
  });
});

describe("the offline queue's idempotency key", () => {
  it("records a replayed action once", async () => {
    const booking = await seedBooking("2026-11-24");
    await confirm(booking.id);

    const [dispatch] = await testSql<{ id: string }[]>`
      SELECT id FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid AND phone = ${DRIVER}
    `;

    // The same tap, replayed three times by a flaky connection.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await testSql`
        INSERT INTO booking_dispatch_actions
          (dispatch_id, client_action_id, action, outcome)
        VALUES (${dispatch.id}::uuid, 'tap-abc-123', 'on_my_way', 'applied')
        ON CONFLICT (dispatch_id, client_action_id) DO NOTHING
      `;
    }

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM booking_dispatch_actions
       WHERE dispatch_id = ${dispatch.id}::uuid
    `;
    expect(count).toBe(1);
  });

  it("keeps two different taps apart", async () => {
    const booking = await seedBooking("2026-11-25");
    await confirm(booking.id);
    const [dispatch] = await testSql<{ id: string }[]>`
      SELECT id FROM booking_dispatch
       WHERE booking_id = ${booking.id}::uuid AND phone = ${DRIVER}
    `;

    for (const id of ["tap-1", "tap-2"]) {
      await testSql`
        INSERT INTO booking_dispatch_actions
          (dispatch_id, client_action_id, action, outcome)
        VALUES (${dispatch.id}::uuid, ${id}, 'on_my_way', 'applied')
        ON CONFLICT (dispatch_id, client_action_id) DO NOTHING
      `;
    }

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM booking_dispatch_actions
       WHERE dispatch_id = ${dispatch.id}::uuid
    `;
    expect(count).toBe(2);
  });
});

describe("the completion photo", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  it("is stored once however many times the upload is replayed", async () => {
    const booking = await seedBooking("2026-11-26");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    // The same tap's photo, retried by a queue flushing on reconnect.
    const outcomes = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await storeDispatchPhoto(
        job,
        "tap-photo-1",
        "image/jpeg",
        JPEG,
      );
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      outcomes.push(result.outcome);
    }

    expect(outcomes).toEqual(["stored", "duplicate", "duplicate"]);

    const rows = await testSql<{ byte_size: number; image: Buffer }[]>`
      SELECT byte_size, image FROM booking_dispatch_photos
       WHERE booking_id = ${booking.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].byte_size).toBe(JPEG.byteLength);
    // The bytes must survive the round trip intact — a photo that decodes to
    // garbage is worse than no photo, because nobody notices until a dispute.
    expect(new Uint8Array(rows[0].image)).toEqual(JPEG);
  });

  it("refuses anything past the size cap, before it reaches the database", async () => {
    const booking = await seedBooking("2026-11-27");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    const oversized = new Uint8Array(PHOTO_MAX_BYTES + 1);
    const result = await storeDispatchPhoto(
      job,
      "tap-huge",
      "image/jpeg",
      oversized,
    );

    expect(result).toEqual({ ok: false, reason: "too_large" });
    const rows = await testSql`
      SELECT 1 FROM booking_dispatch_photos WHERE booking_id = ${booking.id}::uuid
    `;
    expect(rows).toHaveLength(0);
  });

  it("refuses a type a browser would execute rather than render", async () => {
    const booking = await seedBooking("2026-11-28");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    const svg = new TextEncoder().encode("<svg onload='alert(1)'/>");
    const result = await storeDispatchPhoto(
      job,
      "tap-svg",
      "image/svg+xml",
      svg,
    );
    expect(result).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("is refused by the database too, not only by the application", async () => {
    // The backstop for a future admin tool or hand-written insert, exactly like
    // the partial unique index on bookings.
    const booking = await seedBooking("2026-11-29");
    await confirm(booking.id);
    const job = await jobFor(booking.id, DRIVER);

    await expect(
      testSql`
        INSERT INTO booking_dispatch_photos
          (dispatch_id, booking_id, client_action_id, mime_type, byte_size, image)
        VALUES (${job.dispatchId}::uuid, ${job.bookingId}::uuid, 'raw',
                'image/svg+xml', 24, '\\x00'::bytea)
      `,
    ).rejects.toThrow(/booking_dispatch_photos_mime_check/);
  });

  it("is attributed to the recipient who took it", async () => {
    const booking = await seedBooking("2026-11-30");
    await confirm(booking.id);

    const driverJob = await jobFor(booking.id, DRIVER);
    const ownerJob = await jobFor(booking.id, OWNER);

    // The same client action id from two devices: the key is unique PER
    // dispatch, so both are kept and each is traceable to one phone.
    await storeDispatchPhoto(driverJob, "tap-shared", "image/jpeg", JPEG);
    await storeDispatchPhoto(ownerJob, "tap-shared", "image/jpeg", JPEG);

    const rows = await testSql<{ phone: string }[]>`
      SELECT d.phone FROM booking_dispatch_photos p
        JOIN booking_dispatch d ON d.id = p.dispatch_id
       WHERE p.booking_id = ${booking.id}::uuid
       ORDER BY d.phone
    `;
    expect(rows.map((row) => row.phone)).toEqual([DRIVER, OWNER]);
  });
});

describe("the driver login is gone", () => {
  it("user_roles accepts only 'admin'", async () => {
    await expect(
      testSql`
        INSERT INTO user_roles (user_id, role)
        VALUES ('66666666-6666-4666-8666-666666666666'::uuid, 'driver')
      `,
    ).rejects.toThrow();
  });

  it("auth_driver_id() no longer exists", async () => {
    const rows = await testSql`
      SELECT 1 FROM pg_proc WHERE proname = 'auth_driver_id'
    `;
    expect(rows).toHaveLength(0);
  });

  it("no driver-scoped RLS policy survives", async () => {
    const rows = await testSql<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE '%driver%'
    `;
    expect(rows).toHaveLength(0);
  });
});

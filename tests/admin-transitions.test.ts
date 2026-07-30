import { beforeEach, describe, expect, it } from "vitest";
import { testSql, truncateBookings } from "./helpers/db";
import { ALLOWED_TRANSITIONS, ADMIN_TRANSITIONS } from "@/lib/admin/mutations";
import type { BookingStatus } from "@/lib/admin/queries";

/**
 * The state machine, proved where it is actually enforced.
 *
 * The back office only renders buttons for legal moves, but that is a
 * convenience for the operator — it is not what makes an illegal move
 * impossible. These tests bypass the UI and the route entirely and call the SQL
 * function directly, which is what a hand-written POST ultimately reaches.
 *
 * The TypeScript map in mutations.ts exists so the UI knows what to draw. If it
 * ever drifts from the database, the first describe block fails.
 */

const ALL_STATUSES: BookingStatus[] = [
  "holding",
  "pending",
  "confirmed",
  "assigned",
  "en_route",
  "completed",
  "cancelled",
  "expired",
];

async function seed(status: BookingStatus): Promise<string> {
  const rows = await testSql<{ id: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, hold_expires_at,
      customer_name, customer_phone, address_line,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      '2026-12-01'::date, '10:00:00'::time, ${status}::booking_status,
      ${status === "holding" ? testSql`now() + interval '10 minutes'` : null},
      'Transition Test', '+97455000555', 'Villa 3',
      450000, 60000, 35000, 545000
    )
    RETURNING id
  `;
  return rows[0].id;
}

/** Calls the function the API route calls. Resolves true when the move stuck. */
async function attempt(
  bookingId: string,
  to: BookingStatus,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await testSql`
      SELECT transition_booking_status(
        ${bookingId}::uuid, ${to}::booking_status, 'admin'::actor_type,
        'test@yourwaves.qa', '{}'::jsonb
      )
    `;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

beforeEach(async () => {
  await truncateBookings();
});

describe("the UI's map matches the database", () => {
  it("offers nothing the database would refuse", async () => {
    // Every pair the map claims is legal is actually accepted, and every pair
    // it does not claim is actually rejected. Sixty-four combinations, checked
    // against the real function rather than against another copy of the rules.
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;

        const bookingId = await seed(from);
        const result = await attempt(bookingId, to);
        const expected = ALLOWED_TRANSITIONS[from].includes(to);

        expect(
          result.ok,
          `${from} → ${to}: map says ${expected}, database says ${result.ok}` +
            (result.error ? ` (${result.error})` : ""),
        ).toBe(expected);

        await truncateBookings();
      }
    }
  });

  it("never offers an admin a move the full machine disallows", () => {
    for (const status of ALL_STATUSES) {
      for (const move of ADMIN_TRANSITIONS[status]) {
        expect(
          ALLOWED_TRANSITIONS[status],
          `admin map offers ${status} → ${move}`,
        ).toContain(move);
      }
    }
  });
});

describe("illegal transitions are refused by the database", () => {
  it("refuses confirmed → completed, skipping the work", async () => {
    // The move an impatient dispatcher would want, and the one that would
    // leave a job marked done that no driver ever went to.
    const bookingId = await seed("confirmed");
    const result = await attempt(bookingId, "completed");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("illegal_transition");

    const [row] = await testSql<{ status: string }[]>`
      SELECT status::text FROM bookings WHERE id = ${bookingId}::uuid
    `;
    expect(row.status).toBe("confirmed");
  });

  it("refuses to reopen a completed booking", async () => {
    const bookingId = await seed("completed");
    for (const to of ["confirmed", "assigned", "en_route"] as BookingStatus[]) {
      const result = await attempt(bookingId, to);
      expect(result.ok, `completed → ${to}`).toBe(false);
    }
  });

  it("refuses to resurrect a cancelled booking", async () => {
    const bookingId = await seed("cancelled");
    const result = await attempt(bookingId, "confirmed");
    expect(result.ok).toBe(false);
  });

  it("refuses en_route → assigned, which would rewind history", async () => {
    const bookingId = await seed("en_route");
    const result = await attempt(bookingId, "assigned");
    expect(result.ok).toBe(false);
  });

  it("writes no event and sends no notification for a refused move", async () => {
    const bookingId = await seed("confirmed");
    await testSql`DELETE FROM booking_events WHERE booking_id = ${bookingId}::uuid`;
    await testSql`DELETE FROM notifications WHERE booking_id = ${bookingId}::uuid`;

    await attempt(bookingId, "completed");

    // The whole point of doing this in one transaction: a refusal leaves no
    // trace, so nobody is told about a change that did not happen.
    const [{ count: events }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM booking_events
       WHERE booking_id = ${bookingId}::uuid
    `;
    const [{ count: notifications }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
       WHERE booking_id = ${bookingId}::uuid
    `;

    expect(events).toBe(0);
    expect(notifications).toBe(0);
  });
});

describe("a legal transition does everything at once", () => {
  it("moves the booking, writes an event and queues the notification", async () => {
    const bookingId = await seed("confirmed");
    await testSql`DELETE FROM notifications WHERE booking_id = ${bookingId}::uuid`;

    const result = await attempt(bookingId, "assigned");
    expect(result.ok).toBe(true);

    const [booking] = await testSql<{ status: string }[]>`
      SELECT status::text FROM bookings WHERE id = ${bookingId}::uuid
    `;
    expect(booking.status).toBe("assigned");

    const events = await testSql<{ to_status: string; actor_type: string }[]>`
      SELECT to_status::text, actor_type::text FROM booking_events
       WHERE booking_id = ${bookingId}::uuid
    `;
    expect(events.some((event) => event.to_status === "assigned")).toBe(true);
    expect(events.some((event) => event.actor_type === "admin")).toBe(true);

    // The 0007 status trigger fires inside the same transaction.
    const notifications = await testSql<{ template_key: string }[]>`
      SELECT template_key FROM notifications WHERE booking_id = ${bookingId}::uuid
    `;
    expect(
      notifications.some((row) => row.template_key === "booking_assigned"),
    ).toBe(true);
  });
});

describe("driver dispatch", () => {
  let driverA = "";
  let driverB = "";

  beforeEach(async () => {
    await testSql`DELETE FROM dispatch_recipients WHERE full_name LIKE 'Dispatch %'`;
    const a = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone, role)
      VALUES ('Dispatch A', '+97455777001', 'driver') RETURNING id
    `;
    const b = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone, is_active)
      VALUES ('Dispatch B', '+97455777002', false) RETURNING id
    `;
    driverA = a[0].id;
    driverB = b[0].id;
  });

  async function dispatch(bookingId: string, driverId: string) {
    const rows = await testSql<
      {
        outcome: string;
        previous_driver: string | null;
        booking_status: string;
      }[]
    >`SELECT * FROM assign_driver(${bookingId}::uuid, ${driverId}::uuid, 'test')`;
    return rows[0];
  }

  it("assigning a confirmed booking also advances it to assigned", async () => {
    const bookingId = await seed("confirmed");
    const result = await dispatch(bookingId, driverA);

    expect(result.outcome).toBe("ASSIGNED");
    expect(result.booking_status).toBe("assigned");

    // Both messages, from the one status change.
    const templates = await testSql<{ template_key: string }[]>`
      SELECT DISTINCT template_key FROM notifications
       WHERE booking_id = ${bookingId}::uuid
    `;
    const keys = templates.map((row) => row.template_key);
    expect(keys).toContain("booking_assigned");
    // Since phase 9 the driver is told by a dispatch link, not a job-sheet
    // email — enqueue_driver_assignment() mints a token instead.
    expect(keys).toContain("dispatch_job");
  });

  it("refuses an inactive driver", async () => {
    const bookingId = await seed("confirmed");
    const result = await dispatch(bookingId, driverB);

    expect(result.outcome).toBe("DRIVER_INACTIVE");
    const [row] = await testSql<{ assigned_driver: string | null }[]>`
      SELECT assigned_driver FROM bookings WHERE id = ${bookingId}::uuid
    `;
    expect(row.assigned_driver).toBeNull();
  });

  it("refuses to dispatch a completed booking", async () => {
    const bookingId = await seed("completed");
    const result = await dispatch(bookingId, driverA);
    expect(result.outcome).toBe("BOOKING_NOT_DISPATCHABLE");
  });

  it("reassigns, reports the outgoing driver, and re-notifies", async () => {
    const bookingId = await seed("confirmed");
    await dispatch(bookingId, driverA);

    const second = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone)
      VALUES ('Dispatch C', '+97455777003') RETURNING id
    `;

    await testSql`DELETE FROM notifications WHERE booking_id = ${bookingId}::uuid`;
    const result = await dispatch(bookingId, second[0].id);

    expect(result.outcome).toBe("REASSIGNED");
    // The caller needs this to tell the outgoing driver the job has moved.
    expect(result.previous_driver).toBe(driverA);

    const recipients = await testSql<{ recipient: string }[]>`
      SELECT recipient FROM notifications
       WHERE booking_id = ${bookingId}::uuid AND recipient_type = 'driver'
    `;
    expect(recipients.map((row) => row.recipient)).toContain("+97455777003");

    // And the outgoing driver's link is dead — they are no longer entitled to
    // the customer's address.
    const [outgoing] = await testSql<{ revoked_at: string | null }[]>`
      SELECT revoked_at FROM booking_dispatch
       WHERE booking_id = ${bookingId}::uuid AND phone = '+97455777001'
    `;
    expect(outgoing?.revoked_at).not.toBeNull();
  });
});

describe("blackouts", () => {
  it("refuses to close a date that has a live booking", async () => {
    await seed("confirmed");

    const rows = await testSql<{ outcome: string }[]>`
      SELECT * FROM add_blackout_date('2026-12-01'::date, 'maintenance', 'test')
    `;
    expect(rows[0].outcome).toBe("DATE_HAS_BOOKING");

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM blackout_dates
       WHERE date = '2026-12-01'::date
    `;
    expect(count).toBe(0);
  });

  it("closes a free date, and a cancelled booking does not block it", async () => {
    const bookingId = await seed("confirmed");
    await attempt(bookingId, "cancelled");

    const rows = await testSql<{ outcome: string }[]>`
      SELECT * FROM add_blackout_date('2026-12-01'::date, 'staff holiday', 'test')
    `;
    expect(rows[0].outcome).toBe("BLACKED_OUT");
  });
});

describe("deleting a driver", () => {
  async function seedDriver(name: string, phone: string) {
    await testSql`DELETE FROM dispatch_recipients WHERE phone = ${phone}`;
    const rows = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone) VALUES (${name}, ${phone})
      RETURNING id
    `;
    return rows[0].id;
  }

  it("removes a driver who has never been dispatched", async () => {
    const driverId = await seedDriver("Delete Me", "+97455880001");

    const [{ bookings }] = await testSql<{ bookings: number }[]>`
      SELECT count(*)::int AS bookings FROM bookings
       WHERE assigned_driver = ${driverId}::uuid
    `;
    expect(bookings).toBe(0);

    await testSql`DELETE FROM dispatch_recipients WHERE id = ${driverId}::uuid`;
    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM dispatch_recipients WHERE id = ${driverId}::uuid
    `;
    expect(count).toBe(0);
  });

  it("deleting a driver with history would blank the booking — which is why it is refused", async () => {
    /**
     * This test documents the DANGER rather than the guard: it performs the
     * delete the application refuses to perform, and shows what it costs.
     *
     * `bookings.assigned_driver` is ON DELETE SET NULL, so the booking survives
     * but forgets who ran it. `deleteDriver()` counts bookings first and
     * refuses, and the settings screen only offers the button when the count is
     * zero. If that FK is ever changed to CASCADE, this test still passes but
     * the stakes rise — the booking itself would go.
     */
    const driverId = await seedDriver("Has History", "+97455880002");
    const bookingId = await seed("confirmed");

    await testSql`
      UPDATE bookings SET assigned_driver = ${driverId}::uuid
       WHERE id = ${bookingId}::uuid
    `;

    const [{ bookings }] = await testSql<{ bookings: number }[]>`
      SELECT count(*)::int AS bookings FROM bookings
       WHERE assigned_driver = ${driverId}::uuid
    `;
    expect(bookings).toBe(1);

    await testSql`DELETE FROM dispatch_recipients WHERE id = ${driverId}::uuid`;

    const [row] = await testSql<{ assigned_driver: string | null }[]>`
      SELECT assigned_driver FROM bookings WHERE id = ${bookingId}::uuid
    `;
    // The booking is still there, but it no longer knows who did the job.
    expect(row.assigned_driver).toBeNull();
  });

  /**
   * The "deleting a driver revokes their login" test is gone with the feature:
   * phase 9 removed driver logins entirely, so `user_roles.driver_id` no longer
   * exists. What matters now is that deletion revokes their DISPATCH LINKS,
   * which tests/dispatch.test.ts covers.
   */
});

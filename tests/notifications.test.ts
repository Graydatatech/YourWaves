import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testSql, truncateBookings } from "./helpers/db";

/**
 * Phase 7 — the notification outbox.
 *
 * Two layers are exercised:
 *
 *   1. The QUEUE, in SQL. Claiming, the backoff ladder, giving up, the dedupe
 *      key. These are the parts that must hold under a worker running twice a
 *      minute on two instances, so they are tested against the real functions
 *      rather than a mock of them.
 *
 *   2. The TEMPLATES, in TypeScript. That every key renders in both locales,
 *      that Arabic really produces Arabic, and that the WhatsApp parameter
 *      count matches what Meta will have approved.
 *
 * The worker itself is driven end-to-end by scripts/notifications-e2e.mjs,
 * which needs a running server; what is here needs only a database.
 */

const ADMIN_EMAIL = "ops-test@yourwaves.qa";

type BookingSeed = {
  date: string;
  locale?: "ar" | "en";
  email?: string | null;
  status?: string;
  name?: string;
};

async function seedBooking(seed: BookingSeed): Promise<{
  id: string;
  reference: string;
}> {
  const rows = await testSql<{ id: string; reference: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, hold_expires_at, customer_name, customer_phone,
      customer_email, address_line, area, city, locale,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      ${seed.date}::date, '10:00:00'::time,
      ${seed.status ?? "confirmed"}::booking_status,
      -- A CHECK constraint ties these together, so a holding row must arrive
      -- with its expiry in the same statement.
      ${seed.status === "holding" ? testSql`now() + interval '10 minutes'` : null},
      ${seed.name ?? "Test Customer"}, '+97455000111',
      ${seed.email === undefined ? "customer@example.com" : seed.email},
      'Villa 12, Street 850', 'Al Waab', 'Doha', ${seed.locale ?? "en"},
      450000, 60000, 35000, 545000
    )
    RETURNING id, reference
  `;
  return rows[0];
}

/** One claim cycle, without sending: what the worker does before it delivers. */
async function claim(limit = 50) {
  return testSql<{ id: string; template_key: string; attempts: number }[]>`
    SELECT * FROM claim_notifications(${limit}, interval '5 minutes')
  `;
}

/** Pretends the backoff has elapsed, so a retry can be observed immediately. */
async function fastForward(id: string) {
  await testSql`
    UPDATE notifications SET scheduled_for = now() - interval '1 second'
     WHERE id = ${id}::uuid
  `;
}

async function rowById(id: string) {
  const rows = await testSql<
    {
      status: string;
      attempts: number;
      max_attempts: number;
      last_error: string | null;
      seconds_until_retry: number | null;
      claimed_at: string | null;
    }[]
  >`
    SELECT status::text, attempts, max_attempts, last_error, claimed_at,
           EXTRACT(EPOCH FROM (scheduled_for - now()))::int AS seconds_until_retry
      FROM notifications WHERE id = ${id}::uuid
  `;
  return rows[0];
}

beforeAll(async () => {
  await testSql`
    UPDATE settings SET admin_notification_emails = ARRAY[${ADMIN_EMAIL}] WHERE id = 1
  `;
});

beforeEach(async () => {
  await truncateBookings();
});

describe("the outbox is written by the booking lifecycle", () => {
  it("enqueues customer and admin notifications when a booking is confirmed", async () => {
    const booking = await seedBooking({
      date: "2026-09-01",
      status: "holding",
    });

    await testSql`
      UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL
       WHERE id = ${booking.id}::uuid
    `;

    // Scoped away from `dispatch_job`: since phase 9 a confirmed booking also
    // fans out a dispatch link to every default recipient, which is a separate
    // concern and is covered by tests/dispatch.test.ts.
    const rows = await testSql<
      { channel: string; recipient_type: string; template_key: string }[]
    >`
      SELECT channel::text, recipient_type::text, template_key
        FROM notifications
       WHERE booking_id = ${booking.id}::uuid AND template_key <> 'dispatch_job'
       ORDER BY template_key, channel
    `;

    expect(rows).toEqual([
      {
        channel: "email",
        recipient_type: "admin",
        template_key: "admin_booking_confirmed",
      },
      {
        channel: "email",
        recipient_type: "customer",
        template_key: "booking_confirmed",
      },
      {
        channel: "whatsapp",
        recipient_type: "customer",
        template_key: "booking_confirmed",
      },
    ]);
  });

  it("notifies on each later lifecycle transition, without spamming admins", async () => {
    const booking = await seedBooking({ date: "2026-09-02" });

    for (const status of ["assigned", "en_route", "completed"]) {
      await testSql`
        UPDATE bookings SET status = ${status}::booking_status
         WHERE id = ${booking.id}::uuid
      `;
    }

    const rows = await testSql<
      { template_key: string; recipient_type: string }[]
    >`
      SELECT template_key, recipient_type::text FROM notifications
       WHERE booking_id = ${booking.id}::uuid
       ORDER BY template_key
    `;

    const keys = [...new Set(rows.map((row) => row.template_key))].sort();
    expect(keys).toEqual([
      "booking_assigned",
      "booking_completed",
      "booking_en_route",
    ]);
    // Only a new booking is worth an admin's attention; the rest is dashboard.
    expect(rows.some((row) => row.recipient_type === "admin")).toBe(false);
  });

  it("mints the assigned driver a dispatch link", async () => {
    const booking = await seedBooking({ date: "2026-09-03" });
    // Cleared first: `drivers.phone` is unique since 0009, and this row is not
    // covered by truncateBookings (the seeded drivers must survive).
    await testSql`DELETE FROM dispatch_recipients WHERE phone = '+97455222333'`;
    const drivers = await testSql<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone, role)
      VALUES ('Test Driver', '+97455222333', 'driver')
      RETURNING id
    `;

    await testSql`
      UPDATE bookings SET assigned_driver = ${drivers[0].id}::uuid, status = 'assigned'
       WHERE id = ${booking.id}::uuid
    `;

    // WhatsApp only, and carrying a capability token rather than the address:
    // there is no driver portal and no driver email since phase 9.
    const rows = await testSql<
      { channel: string; recipient: string; token: string | null }[]
    >`
      SELECT channel::text, recipient, payload->>'dispatch_token' AS token
        FROM notifications
       WHERE booking_id = ${booking.id}::uuid AND template_key = 'dispatch_job'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("whatsapp");
    expect(rows[0].recipient).toBe("+97455222333");
    expect(rows[0].token?.length ?? 0).toBeGreaterThanOrEqual(40);
  });
});

describe("the same notification is never sent twice", () => {
  it("refuses a duplicate (booking, template, recipient)", async () => {
    const booking = await seedBooking({ date: "2026-09-04" });

    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
       WHERE booking_id = ${booking.id}::uuid
    `;
    expect(count).toBe(3); // customer whatsapp + customer email + one admin
  });

  it("never hands the same row to two concurrent workers", async () => {
    const booking = await seedBooking({ date: "2026-09-05" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    // Independent connections: Promise.all on ONE postgres.js connection is
    // pipelined onto a single backend and serialises for free, which would let
    // a broken claim look correct. Same trap as the phase-5 hold soak.
    const [a, b] = await Promise.all([claim(), claim()]);

    const ids = [...a, ...b].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it("does not re-claim a row that is already in flight", async () => {
    const booking = await seedBooking({ date: "2026-09-06" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    const first = await claim();
    expect(first).toHaveLength(3);

    // A second worker one minute later must find nothing: the first has not
    // finished, and the claim has not gone stale.
    const second = await claim();
    expect(second).toHaveLength(0);
  });

  it("reclaims a row whose worker died", async () => {
    const booking = await seedBooking({ date: "2026-09-07" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);

    // The worker never came back; its claim is now older than the stale window.
    await testSql`
      UPDATE notifications SET claimed_at = now() - interval '10 minutes'
       WHERE id = ${row.id}::uuid
    `;

    const reclaimed = await testSql<{ id: string; attempts: number }[]>`
      SELECT * FROM claim_notifications(1, interval '5 minutes')
    `;
    expect(reclaimed[0]?.id).toBe(row.id);
    // The dead attempt still counted, so a message that crashes the worker
    // cannot be retried forever.
    expect(reclaimed[0].attempts).toBe(2);
  });
});

describe("retries and giving up", () => {
  it("walks the backoff ladder and stops after five attempts", async () => {
    const booking = await seedBooking({ date: "2026-09-08" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);

    const delays: number[] = [];
    let outcome = "";

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const [result] = await testSql<{ mark_notification_failed: string }[]>`
        SELECT mark_notification_failed(${row.id}::uuid, ${`simulated provider failure ${attempt}`}, true)
      `;
      outcome = result.mark_notification_failed;

      const state = await rowById(row.id);
      if (state.status === "failed") break;

      delays.push(state.seconds_until_retry ?? 0);
      // The claim is released each time, so the next tick can pick it up.
      expect(state.claimed_at).toBeNull();

      await fastForward(row.id);
      await claim(1);
    }

    // 1m, 5m, 15m, 1h — the ladder, in seconds.
    expect(delays).toEqual([60, 300, 900, 3600]);
    expect(outcome).toBe("failed_permanently");

    const final = await rowById(row.id);
    expect(final.status).toBe("failed");
    expect(final.attempts).toBe(5);
    expect(final.last_error).toContain("simulated provider failure 5");
  });

  it("gives up immediately on a non-retryable failure", async () => {
    const booking = await seedBooking({ date: "2026-09-09" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);

    const [result] = await testSql<{ mark_notification_failed: string }[]>`
      SELECT mark_notification_failed(${row.id}::uuid, 'whatsapp_400: template does not exist', false)
    `;

    expect(result.mark_notification_failed).toBe("failed_permanently");
    const state = await rowById(row.id);
    expect(state.status).toBe("failed");
    // Burning four more attempts over six hours would only delay the alert.
    expect(state.attempts).toBe(1);
  });

  it("alerts an admin when a notification is given up on", async () => {
    const booking = await seedBooking({ date: "2026-09-10" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);

    await testSql`
      SELECT mark_notification_failed(${row.id}::uuid, 'permanent', false)
    `;

    const alerts = await testSql<
      { recipient: string; payload: Record<string, unknown> }[]
    >`
      SELECT recipient, payload FROM notifications
       WHERE template_key = 'admin_notification_failed'
    `;

    expect(alerts).toHaveLength(1);
    expect(alerts[0].recipient).toBe(ADMIN_EMAIL);
    expect(alerts[0].payload.failed_notification_id).toBe(row.id);
    expect(alerts[0].payload.failed_error).toContain("permanent");
  });

  it("does not alert about a failed alert", async () => {
    const booking = await seedBooking({ date: "2026-09-11" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [first] = await claim(1);
    await testSql`SELECT mark_notification_failed(${first.id}::uuid, 'permanent', false)`;

    const [alert] = await testSql<{ id: string }[]>`
      SELECT id FROM notifications WHERE template_key = 'admin_notification_failed'
    `;

    // The alert itself now fails permanently. Without the guard this would
    // enqueue an alert about the alert, forever.
    await testSql`SELECT claim_notifications(50, interval '0 seconds')`;
    await testSql`SELECT mark_notification_failed(${alert.id}::uuid, 'mail provider down', false)`;

    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
       WHERE template_key = 'admin_notification_failed'
    `;
    expect(count).toBe(1);
  });

  it("requeues on resend, with headroom beyond the exhausted attempts", async () => {
    const booking = await seedBooking({ date: "2026-09-12" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);
    await testSql`SELECT mark_notification_failed(${row.id}::uuid, 'permanent', false)`;

    await testSql`SELECT resend_notification(${row.id}::uuid)`;

    const state = await rowById(row.id);
    expect(state.status).toBe("queued");
    expect(state.max_attempts).toBeGreaterThan(state.attempts);

    // And it is genuinely claimable again. Claim the whole queue rather than
    // one row: `claim` orders by scheduled_for, and the sibling rows from the
    // same booking are older than the just-requeued one.
    const reclaimed = await claim();
    expect(reclaimed.map((r) => r.id)).toContain(row.id);
  });
});

describe("a booking with no email address", () => {
  it("still gets its WhatsApp messages, and does not error", async () => {
    const booking = await seedBooking({ date: "2026-09-13", email: null });

    const [{ enqueue_booking_notifications: count }] = await testSql<
      { enqueue_booking_notifications: number }[]
    >`
      SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')
    `;

    const rows = await testSql<{ channel: string; recipient_type: string }[]>`
      SELECT channel::text, recipient_type::text FROM notifications
       WHERE booking_id = ${booking.id}::uuid
       ORDER BY recipient_type, channel
    `;

    // Admin email + customer WhatsApp. No customer email row at all, rather
    // than a row addressed to nobody that would burn five attempts.
    expect(count).toBe(2);
    expect(rows).toEqual([
      { channel: "email", recipient_type: "admin" },
      { channel: "whatsapp", recipient_type: "customer" },
    ]);
  });

  it("refuses to enqueue a blank recipient", async () => {
    const booking = await seedBooking({ date: "2026-09-14" });

    const [{ enqueue_notification: id }] = await testSql<
      { enqueue_notification: string | null }[]
    >`
      SELECT enqueue_notification(
        ${booking.id}::uuid, 'email', 'customer', '   ',
        'booking_confirmed', 'en', '{}'::jsonb)
    `;

    expect(id).toBeNull();
  });
});

describe("locale", () => {
  it("gives an Arabic booking Arabic templates, and keeps admins in English", async () => {
    const booking = await seedBooking({ date: "2026-09-15", locale: "ar" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    const rows = await testSql<{ recipient_type: string; locale: string }[]>`
      SELECT recipient_type::text, locale FROM notifications
       WHERE booking_id = ${booking.id}::uuid
    `;

    for (const row of rows) {
      expect(row.locale).toBe(row.recipient_type === "admin" ? "en" : "ar");
    }
  });

  it("freezes the payload at enqueue time", async () => {
    const booking = await seedBooking({
      date: "2026-09-16",
      name: "Original Name",
    });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    // The booking changes after the message is queued but before it is sent.
    await testSql`
      UPDATE bookings SET customer_name = 'Changed Later'
       WHERE id = ${booking.id}::uuid
    `;

    const [row] = await testSql<{ payload: { customer_name: string } }[]>`
      SELECT payload FROM notifications WHERE booking_id = ${booking.id}::uuid LIMIT 1
    `;

    // A message describes the event as it happened, not the row as it is now.
    expect(row.payload.customer_name).toBe("Original Name");
  });

  it("captures everything the templates need", async () => {
    const booking = await seedBooking({ date: "2026-09-17" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    const [row] = await testSql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM notifications WHERE booking_id = ${booking.id}::uuid LIMIT 1
    `;

    for (const key of [
      "reference",
      "booking_date",
      "preferred_start",
      "customer_name",
      "customer_phone",
      "address_line",
      "price_rental",
      "price_setup",
      "price_delivery",
      "price_total",
      "currency",
    ]) {
      expect(row.payload[key], `payload.${key}`).toBeDefined();
    }
  });
});

describe("the notification log", () => {
  it("reports attempts, errors and retry state for a booking", async () => {
    const booking = await seedBooking({ date: "2026-09-18" });
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;
    const [row] = await claim(1);
    await testSql`SELECT mark_notification_failed(${row.id}::uuid, 'temporary glitch', true)`;

    const entries = await testSql<
      {
        reference: string;
        attempts: number;
        last_error: string;
        is_waiting_for_retry: boolean;
        status: string;
      }[]
    >`
      SELECT reference, attempts, last_error, is_waiting_for_retry, status::text
        FROM notification_log WHERE id = ${row.id}::uuid
    `;

    expect(entries[0].reference).toBe(booking.reference);
    expect(entries[0].attempts).toBe(1);
    expect(entries[0].last_error).toBe("temporary glitch");
    expect(entries[0].status).toBe("queued");
    expect(entries[0].is_waiting_for_retry).toBe(true);
  });
});

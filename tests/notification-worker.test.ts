import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testSql, truncateBookings } from "./helpers/db";

/**
 * The worker's own behaviour, with the transports replaced by stubs.
 *
 * The queue tests prove the SQL retries correctly when told to; these prove the
 * worker tells it the right thing — that a 502 from a provider becomes a retry,
 * a rejected template becomes an immediate give-up, and neither ever throws out
 * of the batch and strands the rows behind it.
 */

const sendEmail = vi.fn();
const sendWhatsApp = vi.fn();

vi.mock("@/lib/notifications/providers", () => ({
  createEmailProvider: () => ({ name: "stub", send: sendEmail }),
  createWhatsAppSender: () => ({ name: "stub", sendTemplate: sendWhatsApp }),
  resetNotificationProviders: () => {},
}));

const { runNotificationWorker } = await import("@/lib/notifications/worker");
const { NotificationDeliveryError } = await import("@/lib/notifications/types");

const ADMIN_EMAIL = "ops-worker-test@yourwaves.qa";

async function seedConfirmedBooking(date: string, locale: "ar" | "en" = "en") {
  const rows = await testSql<{ id: string; reference: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, customer_name, customer_phone,
      customer_email, address_line, locale,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      ${date}::date, '10:00:00'::time, 'confirmed', 'Worker Test',
      '+97455000222', 'worker@example.com', 'Villa 1, Street 2', ${locale},
      450000, 60000, 35000, 545000
    )
    RETURNING id, reference
  `;
  return rows[0];
}

async function statesFor(bookingId: string) {
  // Excludes the failure alert, which is addressed to an admin and would
  // otherwise appear alongside the row under test.
  return testSql<
    {
      channel: string;
      status: string;
      attempts: number;
      last_error: string | null;
      provider_ref: string | null;
      seconds_until_retry: number | null;
    }[]
  >`
    SELECT channel::text, status::text, attempts, last_error, provider_ref,
           EXTRACT(EPOCH FROM (scheduled_for - now()))::int AS seconds_until_retry
      FROM notifications
     WHERE booking_id = ${bookingId}::uuid
       AND template_key <> 'admin_notification_failed'
     ORDER BY channel
  `;
}

/** Makes every queued row due again, as if the backoff had elapsed. */
async function fastForwardAll() {
  await testSql`
    UPDATE notifications SET scheduled_for = now() - interval '1 second'
     WHERE status = 'queued'
  `;
}

beforeAll(async () => {
  await testSql`
    UPDATE settings SET admin_notification_emails = ARRAY[${ADMIN_EMAIL}] WHERE id = 1
  `;
});

beforeEach(async () => {
  await truncateBookings();
  sendEmail.mockReset();
  sendWhatsApp.mockReset();
  sendEmail.mockResolvedValue({ providerRef: "stub_email_1" });
  sendWhatsApp.mockResolvedValue({ providerRef: "stub_wa_1" });
});

describe("the happy path", () => {
  it("renders and sends each queued notification once", async () => {
    const booking = await seedConfirmedBooking("2026-10-01");
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    const result = await runNotificationWorker();

    expect(result.claimed).toBe(3);
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.retrying).toBe(0);

    // Two emails (customer + admin) and one WhatsApp.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);

    // Real rendered content reached the transport, not a template key.
    const [emailArgs] = sendEmail.mock.calls[0];
    expect(emailArgs.subject).toContain(booking.reference);
    expect(emailArgs.html).toContain("<html");
    expect(emailArgs.text.length).toBeGreaterThan(50);

    const [to, whatsappArgs] = sendWhatsApp.mock.calls[0];
    expect(to).toBe("+97455000222");
    expect(whatsappArgs.templateName).toBe("yw_booking_confirmed");
    expect(whatsappArgs.bodyParams).toHaveLength(5);

    const states = await statesFor(booking.id);
    expect(states.every((row) => row.status === "sent")).toBe(true);
    expect(states.every((row) => row.provider_ref !== null)).toBe(true);
  });

  it("sends Arabic content for an Arabic booking", async () => {
    const booking = await seedConfirmedBooking("2026-10-02", "ar");
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    await runNotificationWorker();

    const customerEmail = sendEmail.mock.calls.find(
      ([message]) => message.to === "worker@example.com",
    );
    expect(customerEmail![0].html).toContain('dir="rtl"');
    expect(customerEmail![0].text).toMatch(/[؀-ۿ]/);

    // The admin copy is English even though the booking is Arabic.
    const adminEmail = sendEmail.mock.calls.find(
      ([message]) => message.to === ADMIN_EMAIL,
    );
    expect(adminEmail![0].html).toContain('dir="ltr"');

    const [, whatsappArgs] = sendWhatsApp.mock.calls[0];
    expect(whatsappArgs.language).toBe("ar");
  });

  it("marks a template with no send form as done without calling a provider", async () => {
    const booking = await seedConfirmedBooking("2026-10-03");
    // The customer copy of this key deliberately renders nothing.
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'email', 'customer',
        'worker@example.com', 'payment_refund_required', 'en', '{}'::jsonb)
    `;

    const result = await runNotificationWorker();

    expect(result.skipped).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();

    // Recorded as sent, so it leaves the queue instead of retrying forever.
    const [state] = await statesFor(booking.id);
    expect(state.status).toBe("sent");
  });
});

describe("a simulated provider failure", () => {
  it("retries, walking the backoff ladder, and stops after five attempts", async () => {
    const booking = await seedConfirmedBooking("2026-10-04");
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'email', 'customer',
        'worker@example.com', 'booking_confirmed', 'en',
        booking_notification_payload(${booking.id}::uuid))
    `;

    sendEmail.mockRejectedValue(
      new NotificationDeliveryError("resend_502: bad gateway", true),
    );

    const delays: number[] = [];

    for (let tick = 1; tick <= 5; tick += 1) {
      const result = await runNotificationWorker();
      expect(result.claimed, `tick ${tick}`).toBe(1);

      const [state] = await statesFor(booking.id);
      expect(state.attempts).toBe(tick);

      if (tick < 5) {
        expect(result.retrying).toBe(1);
        expect(state.status).toBe("queued");
        delays.push(state.seconds_until_retry ?? 0);
        await fastForwardAll();
      } else {
        expect(result.failed).toBe(1);
        expect(state.status).toBe("failed");
      }
    }

    expect(delays).toEqual([60, 300, 900, 3600]);
    expect(sendEmail).toHaveBeenCalledTimes(5);

    const [final] = await statesFor(booking.id);
    expect(final.last_error).toContain("resend_502");

    // A sixth tick must not touch the failed row again — it is done, not
    // merely waiting. The one row it does find is the admin alert that giving
    // up produced.
    sendEmail.mockResolvedValue({ providerRef: "stub_alert" });
    await fastForwardAll();
    const after = await runNotificationWorker();
    expect(after.outcomes).toHaveLength(1);
    expect(after.outcomes[0].templateKey).toBe("admin_notification_failed");

    const [stillFailed] = await statesFor(booking.id);
    expect(stillFailed.status).toBe("failed");
    expect(stillFailed.attempts).toBe(5);
  });

  it("alerts an admin once it gives up", async () => {
    const booking = await seedConfirmedBooking("2026-10-05");
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'whatsapp', 'customer',
        '+97455000222', 'booking_confirmed', 'en',
        booking_notification_payload(${booking.id}::uuid))
    `;

    sendWhatsApp.mockRejectedValue(
      new NotificationDeliveryError("whatsapp_400: bad template", false),
    );

    await runNotificationWorker();

    const alerts = await testSql<{ recipient: string; status: string }[]>`
      SELECT recipient, status::text FROM notifications
       WHERE template_key = 'admin_notification_failed'
    `;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].recipient).toBe(ADMIN_EMAIL);

    // And that alert is itself deliverable on the next tick.
    sendEmail.mockResolvedValue({ providerRef: "stub_alert" });
    const result = await runNotificationWorker();
    expect(result.sent).toBe(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain(booking.reference);
  });

  it("does not retry a permanently rejected send", async () => {
    const booking = await seedConfirmedBooking("2026-10-06");
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'email', 'customer',
        'worker@example.com', 'booking_confirmed', 'en', '{}'::jsonb)
    `;

    sendEmail.mockRejectedValue(
      new NotificationDeliveryError("resend_422: invalid address", false),
    );

    const result = await runNotificationWorker();

    expect(result.failed).toBe(1);
    const [state] = await statesFor(booking.id);
    expect(state.status).toBe("failed");
    // Four more attempts over six hours would fail identically and only delay
    // the admin finding out.
    expect(state.attempts).toBe(1);
  });

  it("treats an unknown template as permanent, not as a retry", async () => {
    const booking = await seedConfirmedBooking("2026-10-07");
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'email', 'customer',
        'worker@example.com', 'no_such_template', 'en', '{}'::jsonb)
    `;

    const result = await runNotificationWorker();

    expect(result.failed).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
    const [state] = await statesFor(booking.id);
    expect(state.status).toBe("failed");
    expect(state.attempts).toBe(1);
    expect(state.last_error).toContain("unknown_template");
  });

  it("keeps sending the rest of the batch when one message fails", async () => {
    const booking = await seedConfirmedBooking("2026-10-08");
    await testSql`SELECT enqueue_booking_notifications(${booking.id}::uuid, 'booking_confirmed')`;

    // Email is broken; WhatsApp is fine. The customer must still get the
    // WhatsApp message rather than being stranded behind the failure.
    sendEmail.mockRejectedValue(
      new NotificationDeliveryError("resend_503", true),
    );

    const result = await runNotificationWorker();

    expect(result.claimed).toBe(3);
    expect(result.sent).toBe(1);
    expect(result.retrying).toBe(2);
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);

    const states = await statesFor(booking.id);
    expect(states.find((row) => row.channel === "whatsapp")?.status).toBe(
      "sent",
    );
  });

  it("survives a provider that throws something that is not an Error", async () => {
    const booking = await seedConfirmedBooking("2026-10-09");
    await testSql`
      SELECT enqueue_notification(${booking.id}::uuid, 'email', 'customer',
        'worker@example.com', 'booking_confirmed', 'en', '{}'::jsonb)
    `;

    sendEmail.mockRejectedValue("a bare string, as badly-written SDKs do");

    const result = await runNotificationWorker();

    // Unknown failures are assumed retryable: giving up on a fault we do not
    // understand risks discarding a message that would have gone through.
    expect(result.retrying).toBe(1);
    const [state] = await statesFor(booking.id);
    expect(state.status).toBe("queued");
    expect(state.last_error).toContain("bare string");
  });
});

describe("batching", () => {
  it("respects the batch size and leaves the rest for the next tick", async () => {
    const first = await seedConfirmedBooking("2026-10-10");
    const second = await seedConfirmedBooking("2026-10-11");
    await testSql`SELECT enqueue_booking_notifications(${first.id}::uuid, 'booking_confirmed')`;
    await testSql`SELECT enqueue_booking_notifications(${second.id}::uuid, 'booking_confirmed')`;

    const firstTick = await runNotificationWorker({ batchSize: 2 });
    expect(firstTick.claimed).toBe(2);
    expect(firstTick.sent).toBe(2);

    const secondTick = await runNotificationWorker({ batchSize: 10 });
    expect(secondTick.claimed).toBe(4);
    expect(secondTick.sent).toBe(4);

    const thirdTick = await runNotificationWorker();
    expect(thirdTick.claimed).toBe(0);
  });
});

import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { testSql } from "./helpers/db";
import { redactSensitive } from "@/lib/payments/provider";
import { MockProvider, signMockWebhook } from "@/lib/payments/mock";
import { fromDecimalString } from "@/lib/payments/skipcash";
import { settleEvent } from "@/lib/payments/service";

/**
 * Payment settlement. Everything here runs against the real database, because
 * every guarantee that matters is transactional or constraint-based.
 */

const PHONE = "+97455880011";

beforeAll(() => {
  process.env.OTP_TOKEN_SECRET =
    "test-secret-that-is-definitely-long-enough-0123456789";
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.MOCK_PAYMENT_SECRET = "test-mock-secret";
});

afterAll(async () => {
  await testSql.end();
});

async function reset() {
  await testSql`
    TRUNCATE bookings, booking_events, payments, payment_events, notifications,
             blackout_dates CASCADE
  `;
  MockProvider.reset();
}

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A held booking with an initiated payment, as checkout would leave things. */
async function seedHoldWithPayment(
  daysAhead: number,
  providerRef = "mock_ref_1",
  amount = 545000,
) {
  const date = futureDate(daysAhead);
  const rows = await testSql<{ booking_id: string; reference: string }[]>`
    SELECT booking_id, reference FROM create_booking_hold(
      ${date}::date, '09:00'::time, 'Payer', ${PHONE},
      'Villa 14, Street 850, Al Wakrah'
    )
  `;
  const bookingId = rows[0].booking_id;
  await testSql`
    INSERT INTO payments (booking_id, provider, provider_ref, amount, currency, status)
    VALUES (${bookingId}::uuid, 'mock', ${providerRef}, ${amount}, 'QAR', 'initiated')
  `;
  return { bookingId, reference: rows[0].reference, date, providerRef };
}

async function settleSuccess(
  providerRef: string,
  eventId: string,
  amount: number | null = 545000,
) {
  const rows = await testSql<
    { outcome: string; booking_id: string | null; reference: string | null }[]
  >`
    SELECT * FROM settle_payment_success(
      'mock', ${providerRef}, ${eventId}, ${amount}, '{"source":"test"}'::jsonb
    )
  `;
  return rows[0];
}

async function settleFailure(providerRef: string, eventId: string) {
  const rows = await testSql<{ outcome: string }[]>`
    SELECT * FROM settle_payment_failure(
      'mock', ${providerRef}, ${eventId}, '{"source":"test"}'::jsonb
    )
  `;
  return rows[0];
}

describe("webhook signature verification", () => {
  it("rejects a call with no signature", async () => {
    const provider = new MockProvider();
    const body = JSON.stringify({ providerRef: "mock_x", status: "paid" });
    const result = await provider.verifyWebhook({
      rawBody: body,
      headers: new Headers(),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("missing_signature");
  });

  it("rejects a wrong signature", async () => {
    const provider = new MockProvider();
    const body = JSON.stringify({ providerRef: "mock_x", status: "paid" });
    const result = await provider.verifyWebhook({
      rawBody: body,
      headers: new Headers({ "x-mock-signature": "not-the-signature" }),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a body that was tampered with after signing", async () => {
    const provider = new MockProvider();
    const original = JSON.stringify({
      providerRef: "mock_x",
      status: "failed",
      amount: 545000,
    });
    const signature = signMockWebhook(original);

    // Same signature, body edited to claim success and a smaller amount.
    const tampered = JSON.stringify({
      providerRef: "mock_x",
      status: "paid",
      amount: 1,
    });

    const result = await provider.verifyWebhook({
      rawBody: tampered,
      headers: new Headers({ "x-mock-signature": signature }),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("bad_signature");
  });

  it("accepts a correctly signed body", async () => {
    const provider = new MockProvider();
    const body = JSON.stringify({
      eventId: "evt_1",
      providerRef: "mock_x",
      status: "paid",
      amount: 545000,
      currency: "QAR",
    });
    const result = await provider.verifyWebhook({
      rawBody: body,
      headers: new Headers({ "x-mock-signature": signMockWebhook(body) }),
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.event.providerRef).toBe("mock_x");
      expect(result.event.status).toBe("paid");
      expect(result.event.amount).toBe(545000);
    }
  });
});

describe("settlement: the happy path", () => {
  beforeEach(reset);

  it("confirms the booking, clears the hold and queues notifications", async () => {
    const seeded = await seedHoldWithPayment(20);

    const result = await settleSuccess(seeded.providerRef, "evt_ok");
    expect(result.outcome).toBe("confirmed");
    expect(result.reference).toBe(seeded.reference);

    const [booking] = await testSql<
      { status: string; hold_expires_at: Date | null }[]
    >`
      SELECT status, hold_expires_at FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(booking.status).toBe("confirmed");
    expect(booking.hold_expires_at).toBeNull();

    const [payment] = await testSql<{ status: string }[]>`
      SELECT status FROM payments WHERE provider_ref = ${seeded.providerRef}
    `;
    expect(payment.status).toBe("paid");

    // The outbox is written in the same transaction, so a confirmed booking can
    // never exist without its notifications queued.
    const notifications = await testSql<
      { channel: string; recipient_type: string; template_key: string }[]
    >`
      SELECT channel, recipient_type, template_key FROM notifications
       WHERE booking_id = ${seeded.bookingId}::uuid
    `;
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.some((n) => n.channel === "whatsapp")).toBe(true);
    expect(notifications.some((n) => n.recipient_type === "admin")).toBe(true);
    expect(
      notifications
        .filter((n) => n.template_key !== "dispatch_job")
        .every((n) => n.template_key.includes("booking_confirmed")),
    ).toBe(true);

    const events = await testSql<{ to_status: string }[]>`
      SELECT to_status FROM booking_events
       WHERE booking_id = ${seeded.bookingId}::uuid ORDER BY created_at
    `;
    expect(events.map((e) => e.to_status)).toContain("confirmed");
  });

  it("makes the date unavailable to everyone else", async () => {
    const seeded = await seedHoldWithPayment(21);
    await settleSuccess(seeded.providerRef, "evt_ok");

    const [attempt] = await testSql<{ error_code: string | null }[]>`
      SELECT error_code FROM create_booking_hold(
        ${seeded.date}::date, '10:00'::time, 'Someone Else', '+97455999888',
        'Villa 9, Doha'
      )
    `;
    expect(attempt.error_code).toBe("DATE_TAKEN");
  });
});

describe("settlement: idempotency", () => {
  beforeEach(reset);

  it("processes the same event twice as exactly one confirmation", async () => {
    const seeded = await seedHoldWithPayment(22);

    const first = await settleSuccess(seeded.providerRef, "evt_dup");
    const second = await settleSuccess(seeded.providerRef, "evt_dup");

    expect(first.outcome).toBe("confirmed");
    expect(second.outcome).toBe("duplicate_event");

    // One confirmation means ONE set of notifications: a duplicate webhook must
    // not message the customer twice.
    const [{ count }] = await testSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
       WHERE booking_id = ${seeded.bookingId}::uuid
    `;
    const [{ confirmations }] = await testSql<{ confirmations: number }[]>`
      SELECT count(*)::int AS confirmations FROM booking_events
       WHERE booking_id = ${seeded.bookingId}::uuid AND to_status = 'confirmed'
    `;
    expect(confirmations).toBe(1);
    expect(count).toBeGreaterThan(0);

    const [{ events }] = await testSql<{ events: number }[]>`
      SELECT count(*)::int AS events FROM payment_events WHERE event_id = 'evt_dup'
    `;
    expect(events).toBe(1);
  });

  it("survives two identical webhooks arriving simultaneously", async () => {
    const seeded = await seedHoldWithPayment(23);

    // Same event id, genuinely concurrent. The unique constraint is what makes
    // this safe — a check-then-act in application code would let both through.
    const [a, b] = await Promise.all([
      settleSuccess(seeded.providerRef, "evt_race"),
      settleSuccess(seeded.providerRef, "evt_race"),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["confirmed", "duplicate_event"]);

    const [{ confirmations }] = await testSql<{ confirmations: number }[]>`
      SELECT count(*)::int AS confirmations FROM booking_events
       WHERE booking_id = ${seeded.bookingId}::uuid AND to_status = 'confirmed'
    `;
    expect(confirmations).toBe(1);
  });
});

describe("settlement: failure leaves the hold intact", () => {
  beforeEach(reset);

  it("keeps the booking holding so the customer can retry", async () => {
    const seeded = await seedHoldWithPayment(24);

    const result = await settleFailure(seeded.providerRef, "evt_fail");
    expect(result.outcome).toBe("failed_hold_kept");

    const [booking] = await testSql<
      { status: string; hold_expires_at: Date | null }[]
    >`
      SELECT status, hold_expires_at FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    // Still held, still ticking: a declined card is usually followed by another.
    expect(booking.status).toBe("holding");
    expect(booking.hold_expires_at).not.toBeNull();

    const [payment] = await testSql<{ status: string }[]>`
      SELECT status FROM payments WHERE provider_ref = ${seeded.providerRef}
    `;
    expect(payment.status).toBe("failed");

    // Nobody else can take the date while it is still held.
    const [attempt] = await testSql<{ error_code: string | null }[]>`
      SELECT error_code FROM create_booking_hold(
        ${seeded.date}::date, '10:00'::time, 'Other', '+97455999777', 'Villa 9, Doha'
      )
    `;
    expect(attempt.error_code).toBe("DATE_TAKEN");

    // And a second attempt on the same booking can still succeed.
    await testSql`
      INSERT INTO payments (booking_id, provider, provider_ref, amount, currency, status)
      VALUES (${seeded.bookingId}::uuid, 'mock', 'mock_ref_retry', 545000, 'QAR', 'initiated')
    `;
    const retry = await settleSuccess("mock_ref_retry", "evt_retry");
    expect(retry.outcome).toBe("confirmed");
  });

  it("ignores a failure that arrives after a success", async () => {
    const seeded = await seedHoldWithPayment(25);
    await settleSuccess(seeded.providerRef, "evt_success_first");

    // Out-of-order delivery must not undo a confirmation.
    const late = await settleFailure(seeded.providerRef, "evt_failure_late");
    expect(late.outcome).toBe("ignored_after_success");

    const [booking] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(booking.status).toBe("confirmed");

    const [payment] = await testSql<{ status: string }[]>`
      SELECT status FROM payments WHERE provider_ref = ${seeded.providerRef}
    `;
    expect(payment.status).toBe("paid");
  });
});

describe("settlement: never moves a booking backwards", () => {
  beforeEach(reset);

  it("leaves an assigned booking alone on a repeat success", async () => {
    const seeded = await seedHoldWithPayment(26);
    await settleSuccess(seeded.providerRef, "evt_one");
    await testSql`
      SELECT transition_booking_status(${seeded.bookingId}::uuid, 'assigned', 'admin')
    `;

    const again = await settleSuccess(seeded.providerRef, "evt_two");
    expect(again.outcome).toBe("already_confirmed");

    const [booking] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(booking.status).toBe("assigned");
  });
});

describe("settlement: expired hold with a late successful payment", () => {
  beforeEach(reset);

  /**
   * POLICY: revive when possible, refund only when the date has genuinely gone.
   * Documented in drizzle/0006_payments_settlement.sql and CLAUDE.md.
   */
  it("REVIVES the booking when the date is still free", async () => {
    const seeded = await seedHoldWithPayment(27);

    // Lapse the hold and sweep it, as the cron would.
    await testSql`
      UPDATE bookings SET hold_expires_at = now() - interval '1 minute'
       WHERE id = ${seeded.bookingId}::uuid
    `;
    await testSql`SELECT expire_stale_holds()`;

    const [expired] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(expired.status).toBe("expired");

    // The payment lands late. Nobody took the date, so honour it.
    const result = await settleSuccess(seeded.providerRef, "evt_late_free");
    expect(result.outcome).toBe("revived");

    const [booking] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(booking.status).toBe("confirmed");

    const [payment] = await testSql<
      { status: string; refund_required: boolean }[]
    >`
      SELECT status, refund_required FROM payments
       WHERE provider_ref = ${seeded.providerRef}
    `;
    expect(payment.status).toBe("paid");
    expect(payment.refund_required).toBe(false);

    // The customer is told they are booked, not that they need a refund.
    const notifications = await testSql<{ template_key: string }[]>`
      SELECT template_key FROM notifications
       WHERE booking_id = ${seeded.bookingId}::uuid
    `;
    expect(
      notifications.some((n) => n.template_key.includes("booking_confirmed")),
    ).toBe(true);
  });

  it("FLAGS A REFUND when the date was reallocated", async () => {
    const seeded = await seedHoldWithPayment(28);

    await testSql`
      UPDATE bookings SET hold_expires_at = now() - interval '1 minute'
       WHERE id = ${seeded.bookingId}::uuid
    `;
    await testSql`SELECT expire_stale_holds()`;

    // Somebody else takes the freed date and pays for it.
    const [rival] = await testSql<{ booking_id: string }[]>`
      SELECT booking_id FROM create_booking_hold(
        ${seeded.date}::date, '11:00'::time, 'Rival', '+97455111222', 'Villa 3, Lusail'
      )
    `;
    expect(rival.booking_id).toBeTruthy();
    await testSql`
      SELECT transition_booking_status(${rival.booking_id}::uuid, 'pending', 'system')
    `;
    await testSql`
      SELECT transition_booking_status(${rival.booking_id}::uuid, 'confirmed', 'system')
    `;

    // Now the original customer's payment arrives. It cannot be honoured.
    const result = await settleSuccess(seeded.providerRef, "evt_late_taken");
    expect(result.outcome).toBe("refund_required");

    const [payment] = await testSql<
      {
        status: string;
        refund_required: boolean;
        refund_reason: string | null;
      }[]
    >`
      SELECT status, refund_required, refund_reason FROM payments
       WHERE provider_ref = ${seeded.providerRef}
    `;
    // Paid AND flagged: the money arrived and has to go back.
    expect(payment.status).toBe("paid");
    expect(payment.refund_required).toBe(true);
    expect(payment.refund_reason).toBe("hold_expired_and_date_reallocated");

    // The original booking is NOT confirmed — the rival's is.
    const [original] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${seeded.bookingId}::uuid
    `;
    expect(original.status).toBe("expired");
    const [other] = await testSql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${rival.booking_id}::uuid
    `;
    expect(other.status).toBe("confirmed");

    // A human has to move the money, so an admin must be told.
    const notifications = await testSql<
      { template_key: string; recipient_type: string }[]
    >`
      SELECT template_key, recipient_type FROM notifications
       WHERE booking_id = ${seeded.bookingId}::uuid
    `;
    expect(
      notifications.some((n) =>
        n.template_key.includes("payment_refund_required"),
      ),
    ).toBe(true);
    expect(notifications.some((n) => n.recipient_type === "admin")).toBe(true);
  });
});

describe("money: the client cannot influence the amount", () => {
  beforeEach(reset);

  it("charges the booking's own price, not anything a caller supplies", async () => {
    const seeded = await seedHoldWithPayment(29);

    const [payment] = await testSql<{ amount: number; currency: string }[]>`
      SELECT amount, currency FROM payments WHERE provider_ref = ${seeded.providerRef}
    `;
    // 450000 + 60000 + 35000 from settings, computed server-side at hold time.
    expect(payment.amount).toBe(545000);
    expect(payment.currency).toBe("QAR");
  });

  it("records a mismatch but still honours a payment the provider took", async () => {
    const seeded = await seedHoldWithPayment(31);

    // The provider reports 1 minor unit — as a tampered client might have caused.
    const result = await settleSuccess(seeded.providerRef, "evt_mismatch", 1);
    expect(result.outcome).toBe("confirmed");

    // The stored amount is ours, never the reported one.
    const [payment] = await testSql<{ amount: number }[]>`
      SELECT amount FROM payments WHERE provider_ref = ${seeded.providerRef}
    `;
    expect(payment.amount).toBe(545000);

    // And the discrepancy is on the record for reconciliation.
    const events = await testSql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM booking_events
       WHERE booking_id = ${seeded.bookingId}::uuid
         AND metadata->>'reason' = 'amount_mismatch'
    `;
    expect(events).toHaveLength(1);
    expect(events[0].metadata.expected).toBe(545000);
    expect(events[0].metadata.received).toBe(1);
  });

  it("converts decimal strings to minor units without float drift", () => {
    expect(fromDecimalString("5450.00")).toBe(545000);
    expect(fromDecimalString("0.01")).toBe(1);
    expect(fromDecimalString("10.10")).toBe(1010);
    // 19.99 * 100 is 1998.9999... in binary floating point.
    expect(fromDecimalString("19.99")).toBe(1999);
    expect(fromDecimalString(5450)).toBe(545000);
  });
});

describe("settlement: unknown payment", () => {
  beforeEach(reset);

  it("does not throw on a reference we have never seen", async () => {
    const result = await settleSuccess("mock_never_seen", "evt_ghost");
    expect(result.outcome).toBe("unknown_payment");
    expect(result.booking_id).toBeNull();
  });
});

describe("card data never reaches storage", () => {
  it("redacts card-shaped keys and bare PANs", () => {
    const redacted = redactSensitive({
      status: "paid",
      cardNumber: "4111111111111111",
      cvv: "123",
      card: { pan: "5555555555554444", exp_month: "12" },
      // A PAN under an innocent key must still go.
      note: "4111111111111111",
      amount: 545000,
      nested: [{ security_code: "999" }],
    }) as Record<string, unknown>;

    expect(redacted.cardNumber).toBe("[redacted]");
    expect(redacted.cvv).toBe("[redacted]");
    expect(redacted.note).toBe("[redacted]");
    // A key called `card` redacts the WHOLE subtree rather than recursing into
    // it — the stricter behaviour, and the one we want: an unknown field nested
    // under `card` is card data by definition.
    expect(redacted.card).toBe("[redacted]");
    expect(
      ((redacted.nested as unknown[])[0] as Record<string, unknown>)
        .security_code,
    ).toBe("[redacted]");

    // Non-sensitive values survive, or the payload would be useless.
    expect(redacted.status).toBe("paid");
    expect(redacted.amount).toBe(545000);
  });
});

describe("jsonb payloads are stored as objects, not strings", () => {
  /**
   * A regression guard for a silent, expensive mistake.
   *
   * `${JSON.stringify(x)}::jsonb` reads correctly and is wrong: postgres.js
   * serialises the parameter itself when it sees the cast, so a pre-stringified
   * object is encoded twice and lands as a jsonb STRING. Nothing errors. The row
   * looks populated. But `payload->>'field'` returns NULL for every field, so
   * the stored evidence is unqueryable exactly when a dispute needs it.
   *
   * Found in phase 8, in phase-6 code that had been passing its tests for two
   * phases — because every other test in this file calls the SQL functions
   * directly with a jsonb LITERAL, which never exercises the parameter
   * encoding. This one goes through settleEvent(), where the bug lived.
   */
  it("keeps a settled payment's raw payload queryable by key", async () => {
    const { bookingId, providerRef } = await seedHoldWithPayment(
      41,
      "mock_jsonb_ref",
    );

    await settleEvent("mock", {
      eventId: `${providerRef}:paid`,
      providerRef,
      status: "paid",
      amount: 545000,
      raw: { provider_status: "CAPTURED", nested: { attempt: 2 } },
    });

    const [payment] = await testSql<
      { is_object: boolean; status_field: string | null }[]
    >`
      SELECT jsonb_typeof(raw_payload) = 'object' AS is_object,
             raw_payload->>'provider_status' AS status_field
        FROM payments WHERE booking_id = ${bookingId}::uuid
    `;
    expect(payment.is_object).toBe(true);
    expect(payment.status_field).toBe("CAPTURED");

    const [event] = await testSql<
      { is_object: boolean; nested: string | null }[]
    >`
      SELECT jsonb_typeof(raw) = 'object' AS is_object,
             raw->'nested'->>'attempt' AS nested
        FROM payment_events WHERE event_id = ${`${providerRef}:paid`}
    `;
    expect(event.is_object).toBe(true);
    expect(event.nested).toBe("2");
  });
});

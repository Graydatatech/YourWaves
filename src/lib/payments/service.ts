import "server-only";

import { sql } from "@/db/client";
import { createPaymentProvider, redactSensitive } from "./index";
import type { PaymentEvent, PaymentStatus } from "./provider";

/**
 * Payment use-cases. Every state change goes through the SQL settlement
 * functions, so the transactional guarantees live in one place.
 */

export type CheckoutRefusal =
  | "NOT_FOUND"
  | "NOT_HOLDING"
  | "HOLD_EXPIRED"
  | "ALREADY_PAID"
  /**
   * The gateway is not set up: a missing credential, or the mock selected in a
   * production build. Distinct from PROVIDER_ERROR on purpose — this one is
   * OUR misconfiguration and no amount of retrying will fix it, whereas
   * PROVIDER_ERROR means the gateway was contacted and something went wrong
   * there, which a retry might well survive.
   *
   * Without this they were indistinguishable: `createPaymentProvider()` threw,
   * escaped the route, and Next answered a bare 500 with no `code`, which the
   * client relabelled PROVIDER_ERROR — so a missing environment variable
   * presented to the customer as "our payment provider is not responding".
   */
  | "NOT_CONFIGURED"
  | "PROVIDER_ERROR";

export type CheckoutStart =
  | { ok: true; redirectUrl: string; providerRef: string; amount: number }
  | { ok: false; code: CheckoutRefusal };

/**
 * Starts a checkout for a held booking.
 *
 * THE AMOUNT IS RECOMPUTED HERE from the booking row, which itself was priced
 * from `settings` when the hold was created. The client never sends an amount and
 * would be ignored if it did — a request body is not a price.
 */
export async function startCheckout(params: {
  bookingId: string;
  phone: string;
  origin: string;
  locale: "ar" | "en";
}): Promise<CheckoutStart> {
  const { bookingId, phone, origin, locale } = params;

  const rows = await sql<
    {
      id: string;
      reference: string;
      status: string;
      hold_expired: boolean;
      customer_name: string;
      customer_phone: string;
      customer_email: string | null;
      price_total: number;
      currency: string;
    }[]
  >`
    SELECT id, reference, status,
           (hold_expires_at IS NULL OR hold_expires_at <= now()) AS hold_expired,
           customer_name, customer_phone, customer_email, price_total, currency
      FROM bookings
     WHERE id = ${bookingId}::uuid AND customer_phone = ${phone}
  `;

  const booking = rows[0];
  if (!booking) return { ok: false, code: "NOT_FOUND" };

  if (
    ["confirmed", "assigned", "en_route", "completed"].includes(booking.status)
  ) {
    return { ok: false, code: "ALREADY_PAID" };
  }
  if (booking.status !== "holding") return { ok: false, code: "NOT_HOLDING" };
  if (booking.hold_expired) return { ok: false, code: "HOLD_EXPIRED" };

  /**
   * The factory throws on a missing credential, and it used to throw straight
   * through this function and out of the route. The customer got a 500 and a
   * message blaming the gateway; the operator got a stack trace. Catching it
   * here turns "someone forgot an environment variable" into a named refusal
   * that says so, in the log and on the screen.
   */
  let provider;
  try {
    provider = createPaymentProvider();
  } catch (error) {
    console.error("[payments] gateway not configured", {
      bookingId,
      // The factory's message names the exact variables that are missing. It
      // contains no secret values — only their names.
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "NOT_CONFIGURED" };
  }

  // Reuse an existing initiated attempt rather than stacking rows: a customer
  // who taps "pay" twice should land on the same hosted page, not create a
  // second payment the provider might both charge.
  const existing = await sql<{ provider_ref: string | null }[]>`
    SELECT provider_ref FROM payments
     WHERE booking_id = ${bookingId}::uuid
       AND provider = ${provider.name}
       AND status = 'initiated'
       AND provider_ref IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1
  `;

  let checkout;
  try {
    checkout = await provider.createCheckout({
      bookingId: booking.id,
      reference: booking.reference,
      amount: booking.price_total,
      currency: booking.currency,
      customer: {
        name: booking.customer_name,
        phone: booking.customer_phone,
        email: booking.customer_email ?? undefined,
      },
      returnUrl: `${origin}/${locale}/booking/success/${booking.reference}`,
      locale,
    });
  } catch (error) {
    console.error("[payments] createCheckout failed", {
      bookingId,
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "PROVIDER_ERROR" };
  }

  // One payment row per provider reference. The partial unique index on
  // (provider, provider_ref) makes a duplicate impossible even under a double
  // tap that races.
  await sql`
    INSERT INTO payments (booking_id, provider, provider_ref, amount, currency, status)
    VALUES (
      ${bookingId}::uuid, ${provider.name}, ${checkout.providerRef},
      ${booking.price_total}, ${booking.currency}, 'initiated'
    )
    ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL
    DO UPDATE SET updated_at = now()
  `;

  if (existing[0]?.provider_ref) {
    console.info("[payments] replacing an earlier initiated attempt", {
      bookingId,
      previous: existing[0].provider_ref,
    });
  }

  return {
    ok: true,
    redirectUrl: checkout.redirectUrl,
    providerRef: checkout.providerRef,
    amount: booking.price_total,
  };
}

export type SettlementOutcome =
  | "duplicate_event"
  | "confirmed"
  | "already_confirmed"
  | "revived"
  | "refund_required"
  | "unknown_payment"
  | "failed_hold_kept"
  | "ignored_after_success";

/** Applies a verified provider event. All the hard parts are in SQL. */
export async function settleEvent(
  providerName: string,
  event: PaymentEvent,
): Promise<{ outcome: SettlementOutcome; reference: string | null }> {
  /**
   * Serialised ONCE here, then cast `::text::jsonb` at every use site.
   *
   * `${JSON.stringify(x)}::jsonb` reads correctly and is wrong: postgres.js
   * serialises the parameter itself when it sees a bare jsonb cast, so a
   * pre-stringified value is encoded TWICE and lands as a jsonb STRING.
   * Nothing errors. The row looks populated. But `raw->>'field'` then returns
   * NULL for every field, so the evidence is unqueryable exactly when a dispute
   * needs it.
   *
   * `::text::jsonb` pins the parameter as text and lets Postgres parse it, which
   * does not depend on the driver's type inference. `sql.json()` is equally
   * correct on a bare SELECT but fails when the value is a function argument.
   * There is a regression guard in tests/payments.test.ts.
   */
  const raw = JSON.stringify(redactSensitive(event.raw));

  if (event.status === "paid") {
    const rows = await sql<
      { outcome: SettlementOutcome; reference: string | null }[]
    >`
      SELECT outcome, reference FROM settle_payment_success(
        ${providerName}, ${event.providerRef}, ${event.eventId},
        ${event.amount ?? null}, ${raw}::text::jsonb
      )
    `;
    return rows[0] ?? { outcome: "unknown_payment", reference: null };
  }

  if (
    event.status === "failed" ||
    event.status === "cancelled" ||
    event.status === "refunded"
  ) {
    const rows = await sql<
      { outcome: SettlementOutcome; reference: string | null }[]
    >`
      SELECT outcome, reference FROM settle_payment_failure(
        ${providerName}, ${event.providerRef}, ${event.eventId}, ${raw}::text::jsonb
      )
    `;
    return rows[0] ?? { outcome: "unknown_payment", reference: null };
  }

  // "pending" and "unknown" are not settlements. Recorded, not acted on — a
  // provider that reports an interim state must not be able to move a booking.
  await sql`
    INSERT INTO payment_events (provider, event_id, raw, outcome)
    VALUES (${providerName}, ${event.eventId}, ${raw}::text::jsonb, 'ignored_non_final')
    ON CONFLICT (provider, event_id) DO NOTHING
  `;
  return { outcome: "duplicate_event", reference: null };
}

export type BookingStatusView = {
  reference: string;
  status: string;
  paymentStatus: string | null;
  bookingDate: string;
  preferredStart: string;
  priceTotal: number;
  currency: string;
  customerName: string;
  addressLine: string;
  area: string | null;
  locale: string;
};

/**
 * Public-ish status view, keyed by the human reference.
 *
 * The reference is in the customer's URL and their WhatsApp message, so it is
 * treated as a bearer token for read-only booking details — and nothing more
 * than the details they already have. No phone number, no email, no payment
 * identifiers are returned.
 */
export async function getBookingStatus(
  reference: string,
): Promise<BookingStatusView | null> {
  const rows = await sql<
    {
      reference: string;
      status: string;
      payment_status: string | null;
      booking_date: string;
      preferred_start: string;
      price_total: number;
      currency: string;
      customer_name: string;
      address_line: string;
      area: string | null;
      locale: string;
    }[]
  >`
    SELECT b.reference, b.status,
           (
             SELECT p.status::text FROM payments p
              WHERE p.booking_id = b.id
              ORDER BY p.created_at DESC LIMIT 1
           ) AS payment_status,
           to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
           to_char(b.preferred_start, 'HH24:MI:SS') AS preferred_start,
           b.price_total, b.currency, b.customer_name, b.address_line, b.area,
           b.locale
      FROM bookings b
     WHERE b.reference = ${reference}
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    reference: row.reference,
    status: row.status,
    paymentStatus: row.payment_status,
    bookingDate: row.booking_date,
    preferredStart: row.preferred_start,
    priceTotal: row.price_total,
    currency: row.currency,
    customerName: row.customer_name,
    addressLine: row.address_line,
    area: row.area,
    locale: row.locale,
  };
}

/**
 * Resolves payments the webhook never settled.
 *
 * A payment stuck in 'initiated' is either an abandoned checkout or a lost
 * webhook, and only the provider can say which. Anything it reports as paid is
 * settled through the SAME function the webhook uses, so a recovered payment
 * takes an identical path and cannot skip a notification.
 */
export async function reconcilePayments(options?: {
  olderThanMinutes?: number;
  limit?: number;
}): Promise<{
  examined: number;
  settled: number;
  discrepancies: Array<{ providerRef: string; reported: PaymentStatus }>;
}> {
  const olderThan = `${options?.olderThanMinutes ?? 30} minutes`;
  const limit = options?.limit ?? 50;

  const stuck = await sql<
    {
      payment_id: string;
      provider: string;
      provider_ref: string;
      booking_id: string;
      amount: number;
    }[]
  >`
    SELECT * FROM payments_needing_reconciliation(${olderThan}::interval, ${limit})
  `;

  const provider = createPaymentProvider();
  const discrepancies: Array<{ providerRef: string; reported: PaymentStatus }> =
    [];
  let settled = 0;

  for (const row of stuck) {
    if (row.provider !== provider.name) {
      // A payment created by a provider we are no longer configured for cannot
      // be queried. Surface it rather than silently skipping.
      discrepancies.push({
        providerRef: row.provider_ref,
        reported: "unknown",
      });
      continue;
    }

    let status: PaymentStatus;
    try {
      status = await provider.fetchStatus(row.provider_ref);
    } catch (error) {
      console.error("[payments/reconcile] fetchStatus failed", {
        providerRef: row.provider_ref,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (status === "pending" || status === "unknown") {
      // Older than the grace period and still not final: worth a human look.
      discrepancies.push({ providerRef: row.provider_ref, reported: status });
      continue;
    }

    const result = await settleEvent(provider.name, {
      // Distinct event id so a reconciliation cannot collide with a webhook that
      // arrives later for the same transition.
      eventId: `${row.provider_ref}:${status}:reconciled`,
      providerRef: row.provider_ref,
      status,
      amount: row.amount,
      raw: { source: "reconciliation", reportedStatus: status },
    });

    if (result.outcome !== "duplicate_event") settled++;

    console.info("[payments/reconcile] settled a stuck payment", {
      providerRef: row.provider_ref,
      reported: status,
      outcome: result.outcome,
    });
  }

  if (discrepancies.length > 0) {
    console.warn(
      "[payments/reconcile] unresolved after grace period",
      discrepancies,
    );
  }

  return { examined: stuck.length, settled, discrepancies };
}

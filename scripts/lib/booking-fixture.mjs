/**
 * Creates and tears down a real confirmed booking over HTTP, for scripts that
 * need one to look at (layout checks, manual QA).
 *
 * Goes through the actual routes — hold, checkout, signed webhook — so the
 * fixture is a booking the system genuinely confirmed, not a row inserted behind
 * its back. A page rendered from hand-written SQL proves nothing about the flow.
 */

import { createHmac, randomBytes } from "node:crypto";

export const OTP_COOKIE_NAME = "yw_phone_verification";
export const PHONE_DIAL = "+974";
export const PHONE_NATIONAL = "77277252";
export const PHONE_E164 = `${PHONE_DIAL}${PHONE_NATIONAL}`;
/** Marks fixture rows so scripts/e2e-cleanup.mjs can find orphans. */
export const FIXTURE_NAME = "E2E Runner";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The same construction as src/lib/otp/token.ts, using the server's secret. */
export function verificationCookie(phone = PHONE_E164) {
  const secret = process.env.OTP_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("OTP_TOKEN_SECRET missing or too short in .env.local");
  }
  const payload = b64url(
    JSON.stringify({
      phone,
      exp: Math.floor(Date.now() / 1000) + 30 * 60,
      jti: randomBytes(12).toString("hex"),
    }),
  );
  const signature = b64url(
    createHmac("sha256", secret).update(payload).digest(),
  );
  return `${OTP_COOKIE_NAME}=${payload}.${signature}`;
}

function mockSecret() {
  return (
    process.env.MOCK_PAYMENT_SECRET ??
    "mock-payment-secret-for-local-development-only"
  );
}

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 300) };
  }
}

export async function firstAvailableDate(base, { from = 30, to = 110 } = {}) {
  for (let offset = from; offset <= to; offset += 1) {
    const now = new Date();
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const date = new Date(midnight + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const response = await fetch(
      `${base}/api/availability?month=${date.slice(0, 7)}`,
    );
    const data = await readBody(response);
    if (data.days?.find((day) => day.date === date)?.state === "available") {
      return date;
    }
  }
  return null;
}

/**
 * hold → checkout → signed webhook. Returns the confirmed booking.
 * Throws with the offending response body if any step refuses.
 */
export async function createConfirmedBooking(base, { locale = "en" } = {}) {
  const date = await firstAvailableDate(base);
  if (!date) throw new Error("no available date within the booking window");

  const cookie = verificationCookie();
  const headers = { "content-type": "application/json", cookie };

  const holdResponse = await fetch(`${base}/api/bookings/hold`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bookingDate: date,
      preferredStart: "10:00",
      customerName: FIXTURE_NAME,
      dialCode: PHONE_DIAL,
      phoneNational: PHONE_NATIONAL,
      customerEmail: "e2e@example.com",
      addressLine: "Villa 12, Street 850",
      area: "Al Waab",
      city: "Doha",
      notes: "layout fixture",
      locale,
    }),
  });
  const hold = await readBody(holdResponse);
  if (holdResponse.status !== 201) {
    throw new Error(
      `hold refused: ${holdResponse.status} ${JSON.stringify(hold)}`,
    );
  }

  const checkoutResponse = await fetch(
    `${base}/api/bookings/${hold.bookingId}/checkout`,
    { method: "POST", headers, body: JSON.stringify({ locale }) },
  );
  const checkout = await readBody(checkoutResponse);
  if (!checkoutResponse.ok) {
    throw new Error(
      `checkout refused: ${checkoutResponse.status} ${JSON.stringify(checkout)}`,
    );
  }

  const providerRef = new URL(checkout.redirectUrl).searchParams.get("ref");
  const rawBody = JSON.stringify({
    eventId: `${providerRef}:paid`,
    providerRef,
    status: "paid",
    amount: checkout.amount,
    currency: hold.currency,
  });

  const webhook = await fetch(`${base}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": createHmac("sha256", mockSecret())
        .update(rawBody, "utf8")
        .digest("base64"),
    },
    body: rawBody,
  });
  const settled = await readBody(webhook);
  if (settled.outcome !== "confirmed") {
    throw new Error(`webhook did not confirm: ${JSON.stringify(settled)}`);
  }

  return {
    bookingId: hold.bookingId,
    reference: hold.reference,
    date,
    priceTotal: hold.priceTotal,
    currency: hold.currency,
    providerRef,
  };
}

/**
 * Cancels the fixture and deletes its queued notifications.
 *
 * Cancelling rather than deleting: booking_events is append-only by trigger, and
 * 'cancelled' is outside both active_bookings and the partial unique index, so
 * the date is genuinely free again.
 *
 * ORDER MATTERS, and it is the opposite of the obvious one. Since phase 7 the
 * cancel itself fires `bookings_notify_status_change`, which enqueues
 * "your booking has been cancelled" to the customer. Deleting first — or in the
 * same statement, where both CTEs see one snapshot — removes the earlier rows
 * and leaves the brand new cancellation ones behind, addressed to a real Qatari
 * number. So: cancel, THEN delete.
 */
export async function releaseFixture(sql, bookingId) {
  const cancelled = await sql`
    UPDATE bookings SET status = 'cancelled', hold_expires_at = NULL
     WHERE id = ${bookingId}::uuid
    RETURNING reference
  `;

  const deleted = await sql`
    DELETE FROM notifications WHERE booking_id = ${bookingId}::uuid
    RETURNING 1
  `;

  return {
    notifications_deleted: deleted.length,
    bookings_cancelled: cancelled.length,
  };
}

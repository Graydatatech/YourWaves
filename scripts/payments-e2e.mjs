/**
 * End-to-end proof of the phase-6 payment path, against a running server and the
 * real database.
 *
 *   hold → checkout → SIGNED webhook → confirmed → the date is gone for everyone
 *
 * Deliberately drives the HTTP routes rather than the SQL functions. The unit
 * tests already cover the functions; what they cannot cover is the wiring — that
 * the route reads the raw body, hands the exact bytes to the verifier, settles,
 * and that the availability API agrees afterwards. A test that called the SQL
 * directly is precisely what let the phase-5 hold route ship returning 500.
 *
 * Runs against PAYMENT_PROVIDER=mock (the default), whose webhooks are genuinely
 * HMAC-signed, so the signature verification path exercised here is the same code
 * a live provider would hit. It does NOT prove SkipCash's wire format — no
 * merchant account exists. See docs/payments-setup.md.
 *
 * The booking it creates is cancelled at the end, so it does not leave a confirmed
 * booking blocking a real date. Cancelled rather than deleted because
 * booking_events is append-only by trigger — see the cleanup block at the bottom.
 *
 * Usage: pnpm payments:e2e [baseUrl]
 */

import { createHmac, randomBytes } from "node:crypto";
import d from "dotenv";
import postgres from "postgres";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const MOCK_SECRET =
  process.env.MOCK_PAYMENT_SECRET ??
  "mock-payment-secret-for-local-development-only";
const OTP_COOKIE_NAME = "yw_phone_verification";

const PHONE_DIAL = "+974";
const PHONE_NATIONAL = "77277252";
const PHONE_E164 = `${PHONE_DIAL}${PHONE_NATIONAL}`;

const pass = [];
const fail = [];

function check(label, ok, detail) {
  (ok ? pass : fail).push(label);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${
      detail ? `  [2m${detail}[0m` : ""
    }`,
  );
}

async function body(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text.slice(0, 300) };
  }
}

/** A date inside settings.max_advance_days (120) and past the lead time. */
function dateOffsetDays(offset) {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(utcMidnight + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Mints the phone-bound cookie /api/otp/verify issues, using the server's own
 * OTP_TOKEN_SECRET and the same construction as src/lib/otp/token.ts.
 *
 * This is not a bypass: the run still has to present a validly-signed token bound
 * to the exact number it books with. It only avoids sending a real WhatsApp
 * message on every run.
 */
function verificationToken(phone) {
  const secret = process.env.OTP_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("OTP_TOKEN_SECRET missing or too short in .env.local");
  }
  const b64url = (input) =>
    Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const payloadJson = JSON.stringify({
    phone,
    exp: Math.floor(Date.now() / 1000) + 30 * 60,
    jti: randomBytes(12).toString("hex"),
  });
  const payload = b64url(payloadJson);
  const signature = b64url(
    createHmac("sha256", secret).update(payload).digest(),
  );
  return `${payload}.${signature}`;
}

/** Posts a webhook the way the mock provider signs them. */
function signedWebhook(payload) {
  const rawBody = JSON.stringify(payload);
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": createHmac("sha256", MOCK_SECRET)
        .update(rawBody, "utf8")
        .digest("base64"),
    },
    body: rawBody,
  };
}

async function dayState(date) {
  const response = await fetch(
    `${BASE}/api/availability?month=${date.slice(0, 7)}`,
  );
  const data = await body(response);
  return data.days?.find((day) => day.date === date)?.state ?? null;
}

async function statusOf(reference) {
  const response = await fetch(
    `${BASE}/api/bookings/by-reference/${reference}/status`,
  );
  return body(response);
}

const cookie = `${OTP_COOKIE_NAME}=${verificationToken(PHONE_E164)}`;
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let bookingId = null;
/** Kept outside the try so the cleanup can report the date it freed. */
let cleanupDate = null;

try {
  // Pick the first free date rather than a fixed offset, so a leftover booking
  // elsewhere in the month does not fail the run for the wrong reason.
  let date = null;
  for (let offset = 30; offset <= 110; offset += 1) {
    const candidate = dateOffsetDays(offset);
    if ((await dayState(candidate)) === "available") {
      date = candidate;
      cleanupDate = candidate;
      break;
    }
  }

  console.log(`\nYourWaves payment end-to-end`);
  console.log(`base     ${BASE}`);
  console.log(`provider ${process.env.PAYMENT_PROVIDER ?? "mock (default)"}`);
  console.log(`date     ${date ?? "none free"}  (Asia/Qatar)\n`);

  check("a free date exists to test against", date !== null, date ?? "");
  if (!date) throw new Error("no available date in the next 110 days");

  // ── 1. hold ────────────────────────────────────────────────────────────────
  const holdResponse = await fetch(`${BASE}/api/bookings/hold`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      bookingDate: date,
      preferredStart: "10:00",
      customerName: "E2E Runner",
      dialCode: PHONE_DIAL,
      phoneNational: PHONE_NATIONAL,
      customerEmail: "e2e@example.com",
      addressLine: "Villa 12, Street 850, Al Waab",
      area: "Al Waab",
      city: "Doha",
      notes: "automated end-to-end run",
      locale: "en",
    }),
  });
  const hold = await body(holdResponse);
  check(
    "hold created",
    holdResponse.status === 201 && Boolean(hold.bookingId),
    `${holdResponse.status} ref=${hold.reference ?? "-"} total=${hold.priceTotal ?? "-"}`,
  );
  if (!hold.bookingId) {
    console.error(JSON.stringify(hold, null, 2));
    throw new Error("hold failed; nothing below would prove anything");
  }
  bookingId = hold.bookingId;

  check(
    "the held date stops being available immediately",
    (await dayState(date)) === "booked",
    `state=${await dayState(date)}`,
  );

  // ── 2. checkout ────────────────────────────────────────────────────────────
  const checkoutResponse = await fetch(
    `${BASE}/api/bookings/${bookingId}/checkout`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      // An amount is sent deliberately, to prove the server ignores it.
      body: JSON.stringify({ locale: "en", amount: 1 }),
    },
  );
  const checkout = await body(checkoutResponse);
  check(
    "checkout returns a redirect url",
    checkoutResponse.ok && typeof checkout.redirectUrl === "string",
    `${checkoutResponse.status} ${checkout.code ?? ""}`,
  );
  if (typeof checkout.redirectUrl !== "string") {
    console.error(JSON.stringify(checkout, null, 2));
    throw new Error("checkout failed");
  }

  const redirect = new URL(checkout.redirectUrl);
  const providerRef = redirect.searchParams.get("ref");
  const serverAmount = Number(redirect.searchParams.get("amount"));

  check("provider reference issued", Boolean(providerRef), providerRef ?? "-");
  check(
    "amount comes from the booking row, not the request body",
    serverAmount === hold.priceTotal && serverAmount !== 1,
    `provider was told ${serverAmount}, client sent 1, booking says ${hold.priceTotal}`,
  );
  check(
    "checkout echoes the same amount to the UI",
    checkout.amount === hold.priceTotal,
    `${checkout.amount}`,
  );

  // ── 3. forged webhooks must not confirm anything ────────────────────────────
  const unsigned = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerRef, status: "paid" }),
  });
  check(
    "unsigned webhook rejected with 401",
    unsigned.status === 401,
    `got ${unsigned.status}`,
  );

  const badSignature = await fetch(`${BASE}/api/payments/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": Buffer.from(randomBytes(32)).toString("base64"),
    },
    body: JSON.stringify({ providerRef, status: "paid" }),
  });
  check(
    "wrongly-signed webhook rejected with 401",
    badSignature.status === 401,
    `got ${badSignature.status}`,
  );

  const afterForgery = await statusOf(hold.reference);
  check(
    "the booking is still unconfirmed after both forgeries",
    afterForgery.confirmed === false && afterForgery.status === "holding",
    `status=${afterForgery.status} confirmed=${afterForgery.confirmed}`,
  );

  // ── 4. the real thing ──────────────────────────────────────────────────────
  const settlePayload = {
    eventId: `${providerRef}:paid`,
    providerRef,
    status: "paid",
    amount: serverAmount,
    currency: hold.currency,
  };
  const settle = await fetch(
    `${BASE}/api/payments/webhook`,
    signedWebhook(settlePayload),
  );
  const settled = await body(settle);
  check(
    "signed webhook confirms the booking",
    settle.status === 200 && settled.outcome === "confirmed",
    `${settle.status} outcome=${settled.outcome}`,
  );

  // ── 5. idempotency ─────────────────────────────────────────────────────────
  const replay = await fetch(
    `${BASE}/api/payments/webhook`,
    signedWebhook(settlePayload),
  );
  const replayed = await body(replay);
  check(
    "a replayed webhook is a no-op and still answers 200",
    replay.status === 200 &&
      ["duplicate_event", "already_confirmed"].includes(replayed.outcome),
    `${replay.status} outcome=${replayed.outcome}`,
  );

  const [{ count: eventRows }] = await sql`
    SELECT count(*)::int AS count FROM payment_events
     WHERE event_id = ${settlePayload.eventId}
  `;
  check(
    "the duplicate wrote no second event row",
    eventRows === 1,
    `${eventRows} row(s) for that event id`,
  );

  // A late failure must never undo a paid booking.
  const lateFailure = await fetch(
    `${BASE}/api/payments/webhook`,
    signedWebhook({
      eventId: `${providerRef}:late-failure`,
      providerRef,
      status: "failed",
    }),
  );
  const lateFailureBody = await body(lateFailure);
  check(
    "a failure arriving after success cannot un-confirm the booking",
    lateFailure.status === 200 &&
      lateFailureBody.outcome === "ignored_after_success",
    `outcome=${lateFailureBody.outcome}`,
  );

  // ── 6. what the success page sees ──────────────────────────────────────────
  const finalStatus = await statusOf(hold.reference);
  check(
    "status endpoint reports confirmed",
    finalStatus.confirmed === true && finalStatus.status === "confirmed",
    `status=${finalStatus.status} payment=${finalStatus.paymentStatus}`,
  );
  check(
    "status endpoint returns the details the success page renders",
    finalStatus.bookingDate === date &&
      Boolean(finalStatus.preferredStart) &&
      finalStatus.priceTotal === hold.priceTotal &&
      Boolean(finalStatus.addressLine),
    `${finalStatus.bookingDate} ${finalStatus.preferredStart} ${finalStatus.priceTotal} ${finalStatus.currency}`,
  );

  const serialised = JSON.stringify(finalStatus);
  check(
    "status endpoint leaks no phone, email or payment identifier",
    !serialised.includes(PHONE_E164) &&
      !serialised.includes(PHONE_NATIONAL) &&
      !serialised.includes("e2e@example.com") &&
      !serialised.includes(providerRef),
  );

  // ── 7. the date is gone for everyone else ──────────────────────────────────
  check(
    "the date is unavailable in the availability API",
    (await dayState(date)) === "booked",
    `state=${await dayState(date)}`,
  );

  const competing = await fetch(`${BASE}/api/bookings/hold`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      bookingDate: date,
      preferredStart: "12:00",
      customerName: "Second Runner",
      dialCode: PHONE_DIAL,
      phoneNational: PHONE_NATIONAL,
      addressLine: "Villa 99, Street 100, Al Waab",
      locale: "en",
    }),
  });
  const competingBody = await body(competing);
  check(
    "a competing hold on that date is refused with 409 DATE_TAKEN",
    competing.status === 409 && competingBody.code === "DATE_TAKEN",
    `${competing.status} code=${competingBody.code}`,
  );

  // ── 8. checkout closes once paid ───────────────────────────────────────────
  const lateCheckout = await fetch(
    `${BASE}/api/bookings/${bookingId}/checkout`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ locale: "en" }),
    },
  );
  const lateCheckoutBody = await body(lateCheckout);
  check(
    "checkout is refused for an already-paid booking",
    lateCheckout.status === 409 && lateCheckoutBody.code === "ALREADY_PAID",
    `${lateCheckout.status} code=${lateCheckoutBody.code}`,
  );

  // ── 9. notification outbox, written in the settling transaction ────────────
  const queued = await sql`
    SELECT template_key, channel, status FROM notifications
     WHERE booking_id = ${bookingId}::uuid
     ORDER BY template_key, channel
  `;
  check(
    "confirmation notifications were enqueued",
    queued.length > 0 &&
      queued.some((row) => row.template_key === "booking_confirmed"),
    queued.map((r) => `${r.template_key}/${r.channel}:${r.status}`).join(" "),
  );

  // ── 10. the .ics the success page offers ───────────────────────────────────
  const ics = await fetch(
    `${BASE}/api/bookings/by-reference/${hold.reference}/calendar`,
  );
  const icsText = await ics.text();
  check(
    "calendar download is a well-formed VEVENT for this booking",
    ics.ok &&
      icsText.startsWith("BEGIN:VCALENDAR") &&
      icsText.includes("BEGIN:VEVENT") &&
      icsText.includes("END:VCALENDAR") &&
      icsText.includes(hold.reference) &&
      icsText.includes(date.replace(/-/g, "")),
    `${ics.status} ${icsText.length}B ${ics.headers.get("content-type")}`,
  );

  // ── 11. audit trail ───────────────────────────────────────────────────────
  const [payment] = await sql`
    SELECT status::text, amount, currency, refund_required,
           raw_payload IS NOT NULL AS has_raw_payload
      FROM payments WHERE booking_id = ${bookingId}::uuid
  `;
  check(
    "payment row is paid, for the right amount, with no refund flagged",
    payment?.status === "paid" &&
      payment.amount === hold.priceTotal &&
      payment.currency === hold.currency &&
      payment.refund_required === false &&
      payment.has_raw_payload === true,
    `${payment?.status} ${payment?.amount} ${payment?.currency} refund=${payment?.refund_required} raw=${payment?.has_raw_payload}`,
  );

  // Exactly one payment row, despite four webhook posts (two forged, one real,
  // one replay) and two checkout calls.
  const [{ count: paymentRows }] = await sql`
    SELECT count(*)::int AS count FROM payments WHERE booking_id = ${bookingId}::uuid
  `;
  check(
    "exactly one payment row for the booking",
    paymentRows === 1,
    `${paymentRows}`,
  );

  console.log(`\nreference ${hold.reference}`);
  console.log(`booking   ${bookingId}`);
  console.log(`payment   ${providerRef}`);
} catch (error) {
  check(
    "run completed without throwing",
    false,
    String(error?.message ?? error),
  );
} finally {
  // Clean up, so a synthetic run does not leave a confirmed booking occupying a
  // real date. Scoped to the id this script created.
  //
  // The booking is CANCELLED rather than deleted: booking_events is append-only
  // by trigger, and a DELETE cascades into it. Cancelling is also the more honest
  // undo — 'cancelled' is outside both `active_bookings` and the partial unique
  // index, so the date is genuinely free again, and the audit trail of what this
  // run did survives.
  //
  // The queued notifications ARE deleted, and that is not optional: they address a
  // real phone number, and phase 7's sender would happily WhatsApp a stranger
  // about a booking that never existed.
  //
  // Cancel FIRST, delete second. Since phase 7 the cancel fires the status
  // trigger and enqueues its own "booking cancelled" messages; doing both in one
  // statement means the DELETE sees the pre-cancel snapshot and leaves those
  // brand new rows behind.
  if (bookingId) {
    const cancelled = await sql`
      UPDATE bookings
         SET status = 'cancelled', hold_expires_at = NULL
       WHERE id = ${bookingId}::uuid
      RETURNING reference
    `;
    const removed = await sql`
      DELETE FROM notifications WHERE booking_id = ${bookingId}::uuid RETURNING 1
    `;
    const cleaned = {
      notifications_deleted: removed.length,
      bookings_cancelled: cancelled.length,
    };
    const freedState = await dayState(cleanupDate ?? "");
    console.log(
      `\ncleaned up: ${JSON.stringify(cleaned)}, date now ${freedState ?? "n/a"}` +
        ` (payment + payment_events rows kept as the audit trail)`,
    );
  }
  await sql.end();
}

console.log(
  `\n${pass.length} passed, ${fail.length} failed` +
    (fail.length ? `\n\nfailed:\n  ${fail.join("\n  ")}` : ""),
);
process.exit(fail.length ? 1 : 0);

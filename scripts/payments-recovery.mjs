/**
 * Proves the two recovery paths for a LOST WEBHOOK.
 *
 * The webhook is the source of truth, but it is delivered over the internet by a
 * third party, so sooner or later one will not arrive. When that happens the
 * customer has paid and our database says 'initiated'. Two things are supposed to
 * fix that:
 *
 *   1. the success page's fetchStatus fallback, after ~10s of fruitless polling;
 *   2. the reconciliation job, for the customer who closed the tab.
 *
 * Both are only worth anything if they actually confirm the booking, and neither
 * can be reached by posting a webhook — so this drives the mock provider into the
 * "paid on their side, silent on ours" state directly.
 *
 * Usage: pnpm payments:recovery [baseUrl]
 */

import d from "dotenv";
import postgres from "postgres";
import {
  firstAvailableDate,
  releaseFixture,
  verificationCookie,
  FIXTURE_NAME,
  PHONE_DIAL,
  PHONE_NATIONAL,
} from "./lib/booking-fixture.mjs";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET;

const failures = [];

function check(ok, label, detail) {
  if (!ok) failures.push(label);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${detail ? `  [2m${detail}[0m` : ""}`,
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

/** hold → checkout, then stop. The provider has a payment; we have 'initiated'. */
async function bookingAwaitingPayment(cookie) {
  const date = await firstAvailableDate(BASE);
  if (!date) throw new Error("no available date within the booking window");

  const headers = { "content-type": "application/json", cookie };
  const hold = await readBody(
    await fetch(`${BASE}/api/bookings/hold`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        bookingDate: date,
        preferredStart: "11:00",
        customerName: FIXTURE_NAME,
        dialCode: PHONE_DIAL,
        phoneNational: PHONE_NATIONAL,
        addressLine: "Villa 12, Street 850",
        area: "Al Waab",
        locale: "en",
      }),
    }),
  );
  if (!hold.bookingId) throw new Error(`hold refused: ${JSON.stringify(hold)}`);

  const checkout = await readBody(
    await fetch(`${BASE}/api/bookings/${hold.bookingId}/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ locale: "en" }),
    }),
  );
  if (!checkout.redirectUrl) {
    throw new Error(`checkout refused: ${JSON.stringify(checkout)}`);
  }

  return {
    ...hold,
    date,
    providerRef: new URL(checkout.redirectUrl).searchParams.get("ref"),
  };
}

/** Money moves on the provider's side; no webhook is sent. */
async function payWithoutTellingUs(providerRef) {
  const response = await fetch(
    `${BASE}/api/payments/mock-checkout?ref=${encodeURIComponent(providerRef)}&status=paid`,
    { method: "POST" },
  );
  return readBody(response);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const cookie = verificationCookie();
const created = [];

try {
  check(
    Boolean(CRON_SECRET),
    "CRON_SECRET is configured",
    CRON_SECRET ? "yes" : "missing",
  );

  // ── path 1: the status page's fetchStatus fallback ─────────────────────────
  console.log("\n[1] lost webhook, customer still on the success page\n");

  const a = await bookingAwaitingPayment(cookie);
  created.push(a.bookingId);
  const silentA = await payWithoutTellingUs(a.providerRef);
  check(
    silentA.ok === true && silentA.webhookSent === false,
    "provider now reports paid, with no webhook sent",
    `${a.providerRef}`,
  );

  const beforeFallback = await readBody(
    await fetch(`${BASE}/api/bookings/by-reference/${a.reference}/status`),
  );
  check(
    beforeFallback.status === "holding" && beforeFallback.confirmed === false,
    "plain polling still shows the booking unconfirmed",
    `status=${beforeFallback.status} payment=${beforeFallback.paymentStatus}`,
  );

  const afterFallback = await readBody(
    await fetch(
      `${BASE}/api/bookings/by-reference/${a.reference}/status?fallback=1`,
    ),
  );
  check(
    afterFallback.status === "confirmed" && afterFallback.confirmed === true,
    "?fallback=1 recovers the booking and confirms it",
    `status=${afterFallback.status} payment=${afterFallback.paymentStatus}`,
  );

  const notifiedA = await sql`
    SELECT template_key FROM notifications WHERE booking_id = ${a.bookingId}::uuid
  `;
  check(
    notifiedA.some((row) => row.template_key === "booking_confirmed"),
    "a booking recovered by fallback still queues its notifications",
    notifiedA.map((r) => r.template_key).join(" "),
  );

  // The recovered booking must be as real as a webhook-confirmed one.
  const stateA = await readBody(
    await fetch(`${BASE}/api/availability?month=${a.date.slice(0, 7)}`),
  );
  check(
    stateA.days?.find((day) => day.date === a.date)?.state === "booked",
    "the date is taken after a fallback recovery",
  );

  await releaseFixture(sql, a.bookingId);

  // ── path 2: the reconciliation job ─────────────────────────────────────────
  console.log("\n[2] lost webhook, customer closed the tab\n");

  const b = await bookingAwaitingPayment(cookie);
  created.push(b.bookingId);
  await payWithoutTellingUs(b.providerRef);

  const beforeCron = await readBody(
    await fetch(`${BASE}/api/bookings/by-reference/${b.reference}/status`),
  );
  check(
    beforeCron.status === "holding",
    "booking sits unconfirmed with nobody watching",
    `status=${beforeCron.status}`,
  );

  // A fresh payment must NOT be touched: reconciling a checkout the customer is
  // still in the middle of would be worse than waiting.
  const tooEarly = await readBody(
    await fetch(`${BASE}/api/cron/reconcile-payments`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
  );
  check(
    tooEarly.examined === 0 && tooEarly.settled === 0,
    "the default 30-minute grace period leaves a fresh payment alone",
    `examined=${tooEarly.examined} settled=${tooEarly.settled}`,
  );

  // Now shorten the grace period rather than waiting half an hour.
  const cron = await readBody(
    await fetch(`${BASE}/api/cron/reconcile-payments?olderThanMinutes=0.001`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
  );
  check(
    cron.examined >= 1 && cron.settled >= 1,
    "reconciliation examines the stuck payment and settles it",
    `examined=${cron.examined} settled=${cron.settled} discrepancies=${cron.discrepancies?.length ?? 0}`,
  );

  const afterCron = await readBody(
    await fetch(`${BASE}/api/bookings/by-reference/${b.reference}/status`),
  );
  check(
    afterCron.status === "confirmed" && afterCron.confirmed === true,
    "the booking is confirmed by reconciliation alone",
    `status=${afterCron.status} payment=${afterCron.paymentStatus}`,
  );

  const notifiedB = await sql`
    SELECT template_key FROM notifications WHERE booking_id = ${b.bookingId}::uuid
  `;
  check(
    notifiedB.some((row) => row.template_key === "booking_confirmed"),
    "a reconciled booking still queues its notifications",
    notifiedB.map((r) => r.template_key).join(" "),
  );

  // Running again must be a no-op, not a second confirmation.
  const rerun = await readBody(
    await fetch(`${BASE}/api/cron/reconcile-payments?olderThanMinutes=0.001`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
  );
  check(
    rerun.settled === 0,
    "a second reconciliation pass settles nothing",
    `examined=${rerun.examined} settled=${rerun.settled}`,
  );

  const [{ count: paymentRows }] = await sql`
    SELECT count(*)::int AS count FROM payments WHERE booking_id = ${b.bookingId}::uuid
  `;
  check(
    paymentRows === 1,
    "still exactly one payment row after reconciliation",
    `${paymentRows}`,
  );
} catch (error) {
  check(
    false,
    "run completed without throwing",
    String(error?.message ?? error),
  );
} finally {
  for (const bookingId of created) {
    await releaseFixture(sql, bookingId).catch(() => {});
  }
  console.log(`\ncleaned up ${created.length} fixture booking(s)`);
  await sql.end();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}`
    : `\nall checks passed`,
);
process.exit(failures.length ? 1 : 0);

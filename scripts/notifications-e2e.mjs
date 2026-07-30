/**
 * End-to-end proof of the phase-7 notification engine, against a running server
 * and the real database.
 *
 *   pay a booking → outbox fills → worker sends → log shows sent
 *   → driver assigned → driver notified → status updates flow
 *
 * Drives the HTTP routes, not the SQL functions. The unit tests cover the queue
 * semantics and the templates; what only a running server can show is the
 * wiring — that the cron endpoint claims real rows, renders real templates,
 * hands them to the configured transport, and marks them.
 *
 * Runs against the console transports, so nothing is delivered to a real
 * address. That is also the limit of what this proves: the Meta and Resend wire
 * formats are unverified until the client provisions those accounts.
 *
 * Usage: pnpm notifications:e2e [baseUrl]
 */

import d from "dotenv";
import postgres from "postgres";
import {
  createConfirmedBooking,
  releaseFixture,
} from "./lib/booking-fixture.mjs";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET;

const pass = [];
const fail = [];

function check(ok, label, detail) {
  (ok ? pass : fail).push(label);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${detail ? `  [2m${detail}[0m` : ""}`,
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

/** One tick of the worker cron. */
async function runWorker() {
  return body(
    await fetch(`${BASE}/api/cron/send-notifications`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
  );
}

async function logFor(bookingId, sql) {
  return sql`
    SELECT template_key, channel::text, recipient_type::text, recipient,
           status::text, attempts, locale, last_error
      FROM notification_log
     WHERE booking_id = ${bookingId}::uuid
     ORDER BY template_key, channel
  `;
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let fixture = null;
let driverId = null;

try {
  check(Boolean(CRON_SECRET), "CRON_SECRET is configured");

  // ── auth ──────────────────────────────────────────────────────────────────
  const unauthorised = await fetch(`${BASE}/api/cron/send-notifications`, {
    method: "POST",
  });
  check(
    unauthorised.status === 401,
    "worker endpoint rejects an unauthenticated call",
    `got ${unauthorised.status}`,
  );

  // Phase 8 replaced the shared-secret guard with a Supabase session, so this
  // script can no longer read the log over HTTP. It reads the same rows
  // directly instead, and `pnpm check:admin-auth` covers the endpoint's own
  // authorisation.
  const adminUnauthorised = await fetch(`${BASE}/api/admin/notifications`, {
    redirect: "manual",
  });
  check(
    [401, 403, 503].includes(adminUnauthorised.status),
    "notifications log rejects an unauthenticated call",
    `got ${adminUnauthorised.status}`,
  );

  // Drain anything left over so the counts below are about this run only.
  await runWorker();

  // ── 1. a paid booking fills the outbox ────────────────────────────────────
  console.log("\n[1] payment confirms a booking\n");

  fixture = await createConfirmedBooking(BASE, { locale: "ar" });
  console.log(`    ${fixture.reference}  ${fixture.date}\n`);

  let rows = await logFor(fixture.bookingId, sql);
  check(
    rows.length === 3,
    "three notifications queued: customer x2, admin x1",
    rows.map((r) => `${r.template_key}/${r.channel}`).join(" "),
  );
  check(
    rows.every((row) => row.status === "queued"),
    "nothing is sent from inside the payment request",
    "all queued",
  );
  check(
    rows
      .filter((row) => row.recipient_type === "customer")
      .every((row) => row.locale === "ar"),
    "an Arabic booking queues Arabic messages",
  );
  check(
    rows.find((row) => row.recipient_type === "admin")?.locale === "en",
    "the admin copy stays English",
  );

  // ── 2. the worker sends them ──────────────────────────────────────────────
  console.log("\n[2] the worker drains the queue\n");

  const first = await runWorker();
  check(
    first.ok && first.claimed >= 3,
    "worker claims the queued rows",
    `claimed=${first.claimed} sent=${first.sent} failed=${first.failed}`,
  );
  check(
    first.failed === 0 && first.retrying === 0,
    "nothing failed or went onto the retry ladder",
    `failed=${first.failed} retrying=${first.retrying}`,
  );

  rows = await logFor(fixture.bookingId, sql);
  check(
    rows.every((row) => row.status === "sent"),
    "every notification is marked sent",
    rows.map((r) => `${r.channel}:${r.status}`).join(" "),
  );
  check(
    rows.every((row) => row.attempts === 1),
    "each took exactly one attempt",
  );

  // ── 3. running again sends nothing ────────────────────────────────────────
  const second = await runWorker();
  check(
    second.claimed === 0,
    "a second worker tick has nothing to claim",
    `claimed=${second.claimed}`,
  );

  const [{ count: total }] = await sql`
    SELECT count(*)::int AS count FROM notifications
     WHERE booking_id = ${fixture.bookingId}::uuid
  `;
  check(
    total === 3,
    "still exactly three rows — nothing was duplicated",
    `${total}`,
  );

  // ── 4. assigning a driver notifies them ───────────────────────────────────
  console.log("\n[3] an admin assigns a driver\n");

  const drivers = await sql`
    INSERT INTO dispatch_recipients (full_name, phone, role)
    VALUES ('E2E Driver', '+97455999888', 'driver')
    RETURNING id
  `;
  driverId = drivers[0].id;

  // What phase 8's "assign" action will do.
  await sql`
    UPDATE bookings SET assigned_driver = ${driverId}::uuid, status = 'assigned'
     WHERE id = ${fixture.bookingId}::uuid
  `;

  rows = await logFor(fixture.bookingId, sql);
  const driverRows = rows.filter((row) => row.recipient_type === "driver");
  check(
    driverRows.length === 2,
    "the driver is notified on both email and WhatsApp",
    driverRows.map((r) => `${r.channel}->${r.recipient}`).join(" "),
  );
  check(
    rows.some(
      (row) =>
        row.template_key === "booking_assigned" &&
        row.recipient_type === "customer",
    ),
    "the customer is told their crew is confirmed",
  );

  const third = await runWorker();
  check(
    third.sent >= 3 && third.failed === 0,
    "the worker delivers the assignment notifications",
    `claimed=${third.claimed} sent=${third.sent}`,
  );

  // ── 5. the rest of the lifecycle ──────────────────────────────────────────
  console.log("\n[4] the booking runs its course\n");

  for (const status of ["en_route", "completed"]) {
    await sql`
      UPDATE bookings SET status = ${status}::booking_status
       WHERE id = ${fixture.bookingId}::uuid
    `;
  }
  const fourth = await runWorker();

  rows = await logFor(fixture.bookingId, sql);
  const keys = [...new Set(rows.map((row) => row.template_key))].sort();
  check(
    keys.includes("booking_en_route") && keys.includes("booking_completed"),
    "each lifecycle transition produced its own template",
    keys.join(" "),
  );
  check(
    rows.every((row) => row.status === "sent"),
    "the whole log for this booking reads sent",
    `${rows.length} rows, ${fourth.sent} sent this tick`,
  );
  check(
    rows.every((row) => !row.last_error),
    "no errors were recorded",
  );

  // ── 6. the admin log and the resend button ────────────────────────────────
  console.log("\n[5] admin visibility\n");

  // Reads the same `notification_log` view the admin screen renders. Going
  // through the endpoint would need a signed-in Supabase session, which this
  // script has no way to mint — see check:admin-auth for that surface.
  const logRows = await sql`
    SELECT id, channel::text, status::text, attempts, sent_at, reference
      FROM notification_log WHERE booking_id = ${fixture.bookingId}::uuid
     ORDER BY created_at
  `;
  check(
    logRows.length === rows.length,
    "the log view shows every send for this booking",
    `${logRows.length} of ${rows.length}`,
  );
  check(
    logRows.every((entry) => entry.attempts >= 1 && entry.sent_at),
    "each entry reports its attempts and when it was sent",
  );
  check(
    logRows.every((entry) => entry.reference === fixture.reference),
    "the view joins the booking reference through",
  );

  // The resend path, exercised through the SQL function the endpoint calls.
  const target = logRows.find((entry) => entry.channel === "email");
  await sql`SELECT resend_notification(${target.id}::uuid)`;
  const [requeued] = await sql`
    SELECT status::text, attempts, max_attempts FROM notifications
     WHERE id = ${target.id}::uuid
  `;
  check(
    requeued.status === "queued" && requeued.max_attempts > requeued.attempts,
    "resend requeues the existing row with headroom",
    `status=${requeued.status} attempts=${requeued.attempts} max=${requeued.max_attempts}`,
  );

  const fifth = await runWorker();
  check(
    fifth.sent === 1,
    "the requeued message goes out on the next tick",
    `claimed=${fifth.claimed} sent=${fifth.sent}`,
  );

  const [{ count: afterResend }] = await sql`
    SELECT count(*)::int AS count FROM notifications
     WHERE booking_id = ${fixture.bookingId}::uuid
  `;
  check(
    afterResend === rows.length,
    "a resend reuses the row, it does not create a second one",
    `${afterResend}`,
  );

  // ── 7. the dev preview ────────────────────────────────────────────────────
  const preview = await fetch(
    `${BASE}/dev/emails?template=booking_confirmed&locale=ar`,
  );
  const previewHtml = await preview.text();
  check(
    preview.ok &&
      previewHtml.includes("YW-2026-0148") &&
      // React 19 emits the attribute as `srcDoc`; HTML attribute names are
      // case-insensitive, so browsers are happy either way.
      /srcdoc=/i.test(previewHtml) &&
      previewHtml.includes("dir=&quot;rtl&quot;"),
    "/dev/emails renders an Arabic template from sample data",
    `${preview.status}, ${previewHtml.length}B`,
  );
} catch (error) {
  check(
    false,
    "run completed without throwing",
    String(error?.message ?? error),
  );
} finally {
  if (fixture) {
    const cleaned = await releaseFixture(sql, fixture.bookingId);
    console.log(`\ncleaned up: ${JSON.stringify(cleaned)}`);
  }
  if (driverId) {
    await sql`DELETE FROM dispatch_recipients WHERE id = ${driverId}::uuid`.catch(() => {});
  }
  await sql.end();
}

console.log(
  `\n${pass.length} passed, ${fail.length} failed` +
    (fail.length ? `\n\nfailed:\n  ${fail.join("\n  ")}` : ""),
);
process.exit(fail.length ? 1 : 0);

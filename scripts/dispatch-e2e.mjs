/**
 * End-to-end proof of the phase-9 dispatch path, against a running server.
 *
 *   payment confirmed → WhatsApp queued per default recipient → open the link
 *   → act on the job → the customer is notified → revoke → the link is dead
 *
 * Drives the real HTTP surface, because the parts that only a server exercises
 * are exactly the risky ones: token resolution, the rate limiter, the state
 * machine behind a valid token, and the fact that a revoked link stops working
 * immediately rather than at the next expiry sweep.
 *
 * Usage: pnpm dispatch:e2e [baseUrl]
 */

import d from "dotenv";
import postgres from "postgres";
import {
  createConfirmedBooking,
  releaseFixture,
} from "./lib/booking-fixture.mjs";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");

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
    return { __raw: text.slice(0, 200) };
  }
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const PHONE_A = "+97455880101";
const PHONE_B = "+97455880102";
let fixture = null;

try {
  // Two default recipients, so "one token each" is observable.
  await sql`DELETE FROM dispatch_recipients WHERE phone IN (${PHONE_A}, ${PHONE_B})`;
  await sql`
    INSERT INTO dispatch_recipients (full_name, phone, role, is_default) VALUES
      ('E2E Driver', ${PHONE_A}, 'driver', true),
      ('E2E Owner',  ${PHONE_B}, 'owner',  true)
  `;

  console.log(`\nYourWaves dispatch end-to-end\nbase ${BASE}\n`);

  fixture = await createConfirmedBooking(BASE);
  console.log(`    ${fixture.reference}  ${fixture.date}\n`);

  // ── 1. payment confirmation dispatches automatically ─────────────────────
  const dispatched = await sql`
    SELECT d.phone, d.full_name, d.token_hash, n.payload->>'dispatch_token' AS token
      FROM booking_dispatch d
      LEFT JOIN notifications n
        ON n.booking_id = d.booking_id
       AND n.template_key = 'dispatch_job' AND n.recipient = d.phone
     WHERE d.booking_id = ${fixture.bookingId}::uuid
     ORDER BY d.phone
  `;

  const mine = dispatched.filter((row) =>
    [PHONE_A, PHONE_B].includes(row.phone),
  );
  check(
    mine.length === 2,
    "a confirmed payment dispatches to every default recipient",
    mine.map((row) => row.phone).join(" "),
  );
  check(
    new Set(mine.map((row) => row.token)).size === 2,
    "each recipient gets their own distinct token",
  );
  check(
    mine.every((row) => row.token && row.token.length >= 40),
    "the WhatsApp message carries the raw link token",
  );

  const tokenA = mine.find((row) => row.phone === PHONE_A).token;
  const tokenB = mine.find((row) => row.phone === PHONE_B).token;

  // ── 2. the job page ───────────────────────────────────────────────────────
  const page = await fetch(`${BASE}/d/${tokenA}`);
  const html = await page.text();

  check(page.status === 200, "the link opens the job sheet", `${page.status}`);
  check(
    html.includes(fixture.reference),
    "the sheet shows the booking reference",
  );
  check(
    html.includes("Street 850"),
    "the full address is on the page, not in the message",
  );
  check(
    /noindex/i.test(html) && /no-referrer/i.test(html),
    "the page is noindex and sends no referrer",
    "the URL is the credential",
  );

  const [opened] = await sql`
    SELECT opened_at FROM booking_dispatch
     WHERE booking_id = ${fixture.bookingId}::uuid AND phone = ${PHONE_A}
  `;
  check(
    opened.opened_at !== null,
    "the open is recorded against that recipient",
  );

  const [logged] = await sql`
    SELECT count(*)::int AS n FROM dispatch_access_log
     WHERE outcome = 'opened' AND dispatch_id IS NOT NULL
  `;
  check(logged.n > 0, "every open is written to the access log");

  // ── 3. a bad token reveals nothing ────────────────────────────────────────
  const tampered = `${tokenA.slice(0, -1)}${tokenA.at(-1) === "A" ? "B" : "A"}`;
  const bad = await fetch(`${BASE}/d/${tampered}`);
  const badHtml = await bad.text();
  check(
    !badHtml.includes(fixture.reference) && !badHtml.includes("Street 850"),
    "a tampered token reveals no booking data",
    `${bad.status}`,
  );

  const junk = await fetch(`${BASE}/d/not-a-real-token`);
  check(
    !(await junk.text()).includes("Street 850"),
    "a junk token reveals nothing",
    `${junk.status}`,
  );

  // ── 4. acting on the job ──────────────────────────────────────────────────
  const actionId = `e2e-${Date.now()}`;
  const act = await fetch(`${BASE}/api/dispatch/${tokenA}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "on_my_way", clientActionId: actionId }),
  });
  const actBody = await body(act);
  check(
    act.status === 200 && actBody.status === "en_route",
    "'On my way' moves the booking to en_route",
    `${act.status} ${actBody.status ?? actBody.error}`,
  );

  const [attributed] = await sql`
    SELECT actor_type::text, actor_id FROM booking_events
     WHERE booking_id = ${fixture.bookingId}::uuid AND to_status = 'en_route'
     ORDER BY created_at DESC LIMIT 1
  `;
  check(
    attributed?.actor_type === "driver" &&
      attributed.actor_id.includes(PHONE_A),
    "the event is attributed to that recipient's phone",
    attributed?.actor_id,
  );

  const [notified] = await sql`
    SELECT count(*)::int AS n FROM notifications
     WHERE booking_id = ${fixture.bookingId}::uuid
       AND template_key = 'booking_en_route'
  `;
  check(notified.n > 0, "the customer is told the crew is on the way");

  // ── 5. the offline queue replaying ────────────────────────────────────────
  const replay = await fetch(`${BASE}/api/dispatch/${tokenA}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "on_my_way", clientActionId: actionId }),
  });
  const replayBody = await body(replay);
  check(
    replay.status === 200 && replayBody.outcome === "duplicate",
    "a replayed action is applied once and still reports success",
    `${replay.status} ${replayBody.outcome}`,
  );

  const [applied] = await sql`
    SELECT count(*)::int AS n FROM booking_events
     WHERE booking_id = ${fixture.bookingId}::uuid AND to_status = 'en_route'
  `;
  check(applied.n === 1, "…and the booking moved exactly once", `${applied.n}`);

  // ── 5b. the completion photo ──────────────────────────────────────────────
  // A minimal but genuinely valid JPEG: a 1x1 grey pixel. Small enough to
  // inline, real enough that the stored bytes can be compared byte for byte.
  const JPEG_BASE64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////" +
    "//////////////////////////////////////////////////8AAAsIAAEAAQEB" +
    "EQD/xAAUAAEAAAAAAAAAAAAAAAAAAAAJ/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/a" +
    "AAgBAQAAPwB//9k=";
  const photoActionId = `e2e-photo-${Date.now()}`;

  async function uploadPhoto(token, payload) {
    return fetch(`${BASE}/api/dispatch/${token}/photo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  const photo = await uploadPhoto(tokenA, {
    clientActionId: photoActionId,
    mimeType: "image/jpeg",
    data: JPEG_BASE64,
  });
  const photoBody = await body(photo);
  check(
    photo.status === 200 && photoBody.outcome === "stored",
    "a completion photo uploads against the job link",
    `${photo.status} ${photoBody.outcome ?? photoBody.error}`,
  );

  const [storedPhoto] = await sql`
    SELECT p.byte_size, p.mime_type, d.phone
      FROM booking_dispatch_photos p
      JOIN booking_dispatch d ON d.id = p.dispatch_id
     WHERE p.booking_id = ${fixture.bookingId}::uuid
  `;
  check(
    storedPhoto?.phone === PHONE_A && storedPhoto.mime_type === "image/jpeg",
    "the photo is attributed to the recipient who sent it",
    storedPhoto?.phone,
  );

  const photoReplay = await uploadPhoto(tokenA, {
    clientActionId: photoActionId,
    mimeType: "image/jpeg",
    data: JPEG_BASE64,
  });
  const photoReplayBody = await body(photoReplay);
  check(
    photoReplay.status === 200 && photoReplayBody.outcome === "duplicate",
    "a replayed upload is stored once and still reports success",
    `${photoReplay.status} ${photoReplayBody.outcome}`,
  );

  const [photoCount] = await sql`
    SELECT count(*)::int AS n FROM booking_dispatch_photos
     WHERE booking_id = ${fixture.bookingId}::uuid
  `;
  check(photoCount.n === 1, "…and exactly one photo exists", `${photoCount.n}`);

  const svg = await uploadPhoto(tokenA, {
    clientActionId: `${photoActionId}-svg`,
    mimeType: "image/svg+xml",
    data: Buffer.from("<svg onload='alert(1)'/>").toString("base64"),
  });
  check(
    svg.status === 422,
    "a scriptable image type is refused",
    `${svg.status}`,
  );

  const oversized = await uploadPhoto(tokenA, {
    clientActionId: `${photoActionId}-big`,
    mimeType: "image/jpeg",
    // Just past the 2MiB cap, before base64 expansion.
    data: Buffer.alloc(2_097_153).toString("base64"),
  });
  check(
    oversized.status === 413 || oversized.status === 422,
    "an oversized photo is refused rather than stored",
    `${oversized.status}`,
  );

  const anonPhoto = await fetch(
    `${BASE}/api/admin/photos/00000000-0000-4000-8000-000000000000`,
  );
  check(
    anonPhoto.status === 401 || anonPhoto.status === 403,
    "photos are not readable without an admin session",
    `${anonPhoto.status}`,
  );

  // ── 6. the state machine still rules ──────────────────────────────────────
  const illegal = await fetch(`${BASE}/api/dispatch/${tokenB}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "on_my_way",
      clientActionId: `e2e-illegal-${Date.now()}`,
    }),
  });
  const illegalBody = await body(illegal);
  // Already en_route: repeating it is "already done", not an error.
  check(
    illegal.status === 200 && illegalBody.outcome === "already_done",
    "re-sending a step already passed is reported as done, not failed",
    `${illegal.status} ${illegalBody.outcome}`,
  );

  // ── 7. revocation is immediate and individual ─────────────────────────────
  const [row] = await sql`
    SELECT id FROM booking_dispatch
     WHERE booking_id = ${fixture.bookingId}::uuid AND phone = ${PHONE_B}
  `;
  await sql`UPDATE booking_dispatch SET revoked_at = now() WHERE id = ${row.id}::uuid`;

  const revoked = await fetch(`${BASE}/d/${tokenB}`);
  const revokedHtml = await revoked.text();
  check(
    !revokedHtml.includes("Street 850"),
    "a revoked link stops showing the address immediately",
    `${revoked.status}`,
  );

  const revokedPost = await fetch(`${BASE}/api/dispatch/${tokenB}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "job_complete",
      clientActionId: `e2e-revoked-${Date.now()}`,
    }),
  });
  check(
    revokedPost.status === 410,
    "a revoked link cannot post a status change",
    `${revokedPost.status}`,
  );

  const stillWorks = await fetch(`${BASE}/d/${tokenA}`);
  check(
    (await stillWorks.text()).includes(fixture.reference),
    "revoking one recipient leaves the other's link working",
  );
} catch (error) {
  check(
    false,
    "run completed without throwing",
    String(error?.message ?? error),
  );
} finally {
  if (fixture) {
    // Before the booking is released: the photo rows are bytes belonging to a
    // fixture, and nothing else clears them.
    await sql`
      DELETE FROM booking_dispatch_photos WHERE booking_id = ${fixture.bookingId}::uuid
    `;
    const cleaned = await releaseFixture(sql, fixture.bookingId);
    console.log(`\ncleaned up: ${JSON.stringify(cleaned)}`);
  }
  await sql`DELETE FROM dispatch_recipients WHERE phone IN (${PHONE_A}, ${PHONE_B})`;
  await sql.end();
}

console.log(
  `\n${pass.length} passed, ${fail.length} failed` +
    (fail.length ? `\n\nfailed:\n  ${fail.join("\n  ")}` : ""),
);
process.exit(fail.length ? 1 : 0);

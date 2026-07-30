/**
 * Proves that NO admin surface is reachable without a session.
 *
 * The brief asks for exactly this, and it is the kind of claim that has to be
 * made against a running server rather than by reading code: the guard lives in
 * three places (the proxy, the dashboard layout, and requireAdmin in every
 * route), and only an actual HTTP request exercises all three at once.
 *
 * What counts as "rejected":
 *   - a page must NOT return its content; a redirect to /admin/login is the
 *     expected answer, and a 200 carrying booking data is a failure;
 *   - an API route must answer with a refusing STATUS and no data. 401 when a
 *     Supabase project is configured and nobody is signed in; 503 when no
 *     project is configured at all, because then the back office cannot
 *     authenticate anyone and is closed rather than open.
 *
 * Redirects are NOT followed. `fetch` follows them by default, which would turn
 * a redirect-to-login into a 200 carrying the login page — indistinguishable
 * from success to anything checking `response.ok`. That is exactly the bug this
 * script found on its first run.
 *
 * Usage: pnpm check:admin-auth [baseUrl]
 */

import d from "dotenv";

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

/** Pages: a redirect to the login screen, or anything but their own content. */
const PAGES = [
  "/admin",
  "/admin/calendar",
  "/admin/orders",
  "/admin/settings",
  "/admin/bookings/YW-2026-0001",
];

/** A refusal, in either of its legitimate forms. */
const REFUSED = new Set([401, 403, 503]);

/** API: a status code, and no payload. */
const API_GETS = [
  "/api/admin/orders",
  "/api/admin/orders?format=csv",
  "/api/admin/settings",
  "/api/admin/recipients",
  "/api/admin/notifications",
];

const API_WRITES = [
  ["POST", "/api/admin/bookings/YW-2026-0001/transition", { to: "completed" }],
  [
    "POST",
    "/api/admin/bookings/YW-2026-0001/assign",
    { driverId: "00000000-0000-4000-8000-000000000000" },
  ],
  [
    "POST",
    "/api/admin/bookings/YW-2026-0001/notes",
    { body: "should not work" },
  ],
  ["POST", "/api/admin/blackouts", { date: "2026-12-25", reason: "nope" }],
  ["DELETE", "/api/admin/blackouts?date=2026-12-25", null],
  ["PATCH", "/api/admin/settings", { priceRental: 1 }],
  [
    "POST",
    "/api/admin/recipients",
    { fullName: "Intruder", phone: "+97455000000" },
  ],
  [
    "PATCH",
    "/api/admin/recipients/00000000-0000-4000-8000-000000000000",
    { isActive: false },
  ],
  ["DELETE", "/api/admin/notes/00000000-0000-4000-8000-000000000000", null],
  [
    "POST",
    "/api/admin/notifications/00000000-0000-4000-8000-000000000000/resend",
    null,
  ],
];

console.log(`\nAdmin authorisation — unauthenticated caller\nbase ${BASE}\n`);

for (const path of PAGES) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const body = response.status === 200 ? await response.text() : "";

  const redirectedToLogin =
    (response.status === 307 ||
      response.status === 302 ||
      response.status === 303) &&
    location.includes("/admin/login");

  // A 200 is only acceptable if it is not actually the dashboard — checked by
  // looking for content that only a signed-in page renders.
  const leaked =
    response.status === 200 &&
    /YourWaves ops|Needs a driver|Audit timeline|Driver dispatch/.test(body);

  check(
    redirectedToLogin && !leaked,
    `${path} is not served without a session`,
    `${response.status}${location ? ` → ${location.replace(BASE, "")}` : ""}`,
  );
}

for (const path of API_GETS) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const text = await response.text();

  check(
    REFUSED.has(response.status) && !text.includes("reference"),
    `GET ${path} is refused`,
    `${response.status}`,
  );
}

for (const [method, path, body] of API_WRITES) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  check(
    REFUSED.has(response.status),
    `${method} ${path} is refused`,
    `${response.status}`,
  );
}

// The old phase-7 shared secret must no longer open anything: session auth
// replaced it, and a stale secret in someone's environment must not work.
const staleSecret = process.env.ADMIN_API_SECRET;
if (staleSecret) {
  const response = await fetch(`${BASE}/api/admin/notifications`, {
    headers: { authorization: `Bearer ${staleSecret}` },
    redirect: "manual",
  });
  check(
    REFUSED.has(response.status),
    "the retired ADMIN_API_SECRET no longer grants access",
    `${response.status}`,
  );
}

// The login page itself must remain reachable, or nobody can ever get in.
const login = await fetch(`${BASE}/admin/login`);
check(login.status === 200, "/admin/login is reachable", `${login.status}`);

console.log(
  `\n${pass.length} passed, ${fail.length} failed` +
    (fail.length ? `\n\nfailed:\n  ${fail.join("\n  ")}` : ""),
);
process.exit(fail.length ? 1 : 0);

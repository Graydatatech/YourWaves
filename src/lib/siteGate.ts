import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The pre-launch gate.
 *
 * While `SITE_PASSWORD` is set, every page of the public site asks for it
 * first. Unset — which is the state a normal deployment is in — and none of
 * this runs: `isSiteLocked()` is false and the proxy returns immediately. That
 * is the whole switch. Launching is deleting an environment variable, not
 * deploying a code change, so nobody has to remember to take the gate out.
 *
 * NOT A SECURITY BOUNDARY, and it must not be mistaken for one. It stops a
 * client's colleague, a crawler and an accidental link-share from seeing an
 * unfinished site. It is one shared secret with no rate limit and no per-person
 * identity, and everything that actually needs protecting is protected
 * elsewhere: /admin behind Supabase Auth with mandatory TOTP, /d/<token> and
 * /r/<token> behind capability tokens, the payment webhook behind an HMAC.
 * Removing those and relying on this would be a serious downgrade.
 *
 * `node:crypto` is available because Next 16's proxy runs on the Node.js
 * runtime and cannot be set to edge — see the gotchas in CLAUDE.md §2.
 */

export const SITE_GATE_COOKIE = "yw_site_access";
/** Two weeks. Long enough that the client is not re-typing it all week. */
export const SITE_GATE_TTL_SECONDS = 14 * 24 * 60 * 60;

/** The path that asks for the password. Never gated, for obvious reasons. */
export const SITE_GATE_PATH = "/access";

function secret(): string {
  return process.env.SITE_PASSWORD?.trim() ?? "";
}

/** True when a password is configured. Absent or blank means the site is open. */
export function isSiteLocked(): boolean {
  return secret() !== "";
}

/**
 * Paths the gate never touches, and why each one has to be here.
 *
 * Getting this list wrong is the failure mode of a pre-launch gate: it is
 * invisible in a browser, because a human always arrives through the front
 * door, and it silently breaks machines that arrive through the side.
 */
function isExempt(pathname: string): boolean {
  return (
    // The gate itself, and the endpoint that opens it.
    pathname === SITE_GATE_PATH ||
    pathname.startsWith(`${SITE_GATE_PATH}/`) ||
    pathname === "/api/access" ||
    /*
     * SkipCash's callback and Vercel Cron. Both are machines with no cookie
     * jar and no way to be told a password — gating them would mean bookings
     * that never confirm and an outbox that never drains, and neither failure
     * looks like a locked site. Both already authenticate: the webhook by
     * HMAC signature, the crons by CRON_SECRET.
     */
    pathname.startsWith("/api/") ||
    /*
     * The back office, which has real authentication in front of it — email
     * and password plus mandatory TOTP. Adding a shared passphrase in front of
     * that protects nothing and risks locking the client out of their own
     * dashboard on launch day.
     */
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    /*
     * Capability URLs. A driver opening a job sheet from a message and a
     * customer opening a survey link are the two people who most obviously
     * cannot be handed a site password — and the token in the URL is already
     * a stronger credential than the gate.
     */
    pathname.startsWith("/d/") ||
    pathname.startsWith("/r/") ||
    // Framework internals and anything with a file extension: /_next/*, fonts,
    // images, favicon.ico, robots.txt. Without this the gate page itself
    // renders unstyled, which is how most people discover they got it wrong.
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/media/") ||
    pathname.startsWith("/fonts/") ||
    pathname.includes(".")
  );
}

/** Constant-time compare that does not leak length through an early return. */
function sameSecret(candidate: string): boolean {
  const expected = Buffer.from(secret(), "utf8");
  const given = Buffer.from(candidate, "utf8");
  // timingSafeEqual throws on a length mismatch, so compare a digest of each:
  // equal-length inputs, and the comparison itself stays constant-time.
  const a = createHmac("sha256", "site-gate-compare").update(expected).digest();
  const b = createHmac("sha256", "site-gate-compare").update(given).digest();
  return timingSafeEqual(a, b);
}

/**
 * The cookie value: an expiry and a signature over it.
 *
 * Signed rather than stored raw, so the cookie is not the password sitting in
 * a jar where a screenshot or a shared laptop hands it over. Signed WITH the
 * password, so changing SITE_PASSWORD invalidates every cookie already issued
 * — which is what you want the moment the passphrase has been over-shared.
 */
export function issueGateToken(now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + SITE_GATE_TTL_SECONDS;
  return `${expiry}.${sign(String(expiry))}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function isValidGateToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  if (!expiry || !signature) return false;

  const expected = sign(expiry);
  if (expected.length !== signature.length) return false;
  if (
    !timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"))
  ) {
    return false;
  }

  const seconds = Number(expiry);
  return Number.isFinite(seconds) && seconds * 1000 > now;
}

/**
 * HTTP Basic, for the things that cannot fill in a form.
 *
 * An uptime check, a `curl`, a Lighthouse run from CI. Any username is
 * accepted and only the password is compared — inventing a username would be a
 * second shared secret to communicate, and it protects nothing.
 */
export function hasValidBasicAuth(header: string | null): boolean {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;
  return sameSecret(decoded.slice(separator + 1));
}

/** Whether this request may pass. */
export function isRequestAllowed(request: {
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
}): boolean {
  if (!isSiteLocked()) return true;
  if (isExempt(request.nextUrl.pathname)) return true;
  if (isValidGateToken(request.cookies.get(SITE_GATE_COOKIE)?.value)) {
    return true;
  }
  return hasValidBasicAuth(request.headers.get("authorization"));
}

/** Verifies what somebody typed into the form. */
export function isCorrectPassword(candidate: string): boolean {
  if (!isSiteLocked()) return false;
  return sameSecret(candidate);
}

export function gateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Secure would break http://localhost during development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SITE_GATE_TTL_SECONDS,
  };
}

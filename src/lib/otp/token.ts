import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived proof that a CONTACT was verified.
 *
 * Phases 5 (payment) and 6 (notifications) will require this before acting on a
 * booking. It is a compact HMAC-signed token — the same construction as a JWT
 * with HS256, hand-rolled because the payload is three fields and an audited
 * 40-line implementation is easier to reason about than a dependency.
 *
 * THE TOKEN IS BOUND TO THE SUBJECT — the phone or the email, whichever the
 * active channel can actually reach (see OtpChannel.target). `verifyOtpToken`
 * takes the value it is expected to attest to and rejects a mismatch. Without
 * that binding an attacker could verify a contact they control and submit a
 * booking against somebody else's: the token would prove "something was
 * verified", which is worthless.
 *
 * `sub` rather than `phone`, because the same token now carries an email
 * address when OTP_CHANNEL=email, and a field called `phone` holding an inbox
 * is the kind of thing that misleads whoever reads it next.
 *
 * Stored in an HttpOnly cookie so page JavaScript (and anything injected into
 * it) cannot read or exfiltrate it.
 */

export const TOKEN_TTL_SECONDS = 30 * 60;
/**
 * Renamed with the payload. A cookie minted before the token carried `sub`
 * would decode to a shape with no subject and be refused as malformed — a
 * correct outcome, but reached by a confusing route. A new name makes a stale
 * cookie simply absent instead.
 */
export const OTP_COOKIE_NAME = "yw_contact_verification";

type TokenPayload = {
  /** The E.164 phone or the email address this token attests to. */
  sub: string;
  /** Unix seconds. */
  exp: number;
  /** Random, so two tokens for the same subject are never byte-identical. */
  jti: string;
};

function secret(): string {
  const value = process.env.OTP_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "OTP_TOKEN_SECRET must be set to at least 32 characters. " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  return value;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(body: string): string {
  return b64url(createHmac("sha256", secret()).update(body).digest());
}

export function issueOtpToken(subject: string, now = Date.now()): string {
  const payload: TokenPayload = {
    sub: subject,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
    jti: randomBytes(12).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export type TokenVerdict =
  | { valid: true; subject: string; expiresAt: number }
  | {
      valid: false;
      reason: "malformed" | "bad_signature" | "expired" | "subject_mismatch";
    };

/**
 * Validates a token AND that it belongs to `expectedSubject`.
 *
 * Order matters: the signature is checked before anything in the payload is
 * trusted, and the comparison is timing-safe so the digest cannot be probed
 * byte by byte.
 */
export function verifyOtpToken(
  token: string | undefined,
  expectedSubject: string,
  now = Date.now(),
): TokenVerdict {
  if (!token) return { valid: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [body, signature] = parts;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as TokenPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    !payload.sub
  ) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp * 1000 <= now) return { valid: false, reason: "expired" };

  // The binding check. A validly-signed, unexpired token for +974...111 must not
  // authorise a booking for +974...222.
  if (payload.sub !== expectedSubject) {
    return { valid: false, reason: "subject_mismatch" };
  }

  return { valid: true, subject: payload.sub, expiresAt: payload.exp * 1000 };
}

/** Cookie attributes used by both the set and clear paths. */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Secure would break http://localhost during development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

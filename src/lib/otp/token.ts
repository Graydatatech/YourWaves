import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived proof that a phone number was verified.
 *
 * Phases 5 (payment) and 6 (notifications) will require this before acting on a
 * booking. It is a compact HMAC-signed token — the same construction as a JWT
 * with HS256, hand-rolled because the payload is three fields and an audited
 * 40-line implementation is easier to reason about than a dependency.
 *
 * THE TOKEN IS BOUND TO THE PHONE NUMBER. `verifyOtpToken` takes the phone it is
 * expected to be for and rejects a mismatch. Without that binding, an attacker
 * could verify a number they control and then submit a booking against someone
 * else's — the token would prove "some number was verified", which is worthless.
 *
 * Stored in an HttpOnly cookie so page JavaScript (and anything injected into
 * it) cannot read or exfiltrate it.
 */

export const TOKEN_TTL_SECONDS = 30 * 60;
export const OTP_COOKIE_NAME = "yw_phone_verification";

type TokenPayload = {
  /** E.164 phone this token attests to. */
  phone: string;
  /** Unix seconds. */
  exp: number;
  /** Random, so two tokens for the same phone are never byte-identical. */
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

export function issueOtpToken(phone: string, now = Date.now()): string {
  const payload: TokenPayload = {
    phone,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
    jti: randomBytes(12).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export type TokenVerdict =
  | { valid: true; phone: string; expiresAt: number }
  | {
      valid: false;
      reason: "malformed" | "bad_signature" | "expired" | "phone_mismatch";
    };

/**
 * Validates a token AND that it belongs to `expectedPhone`.
 *
 * Order matters: the signature is checked before anything in the payload is
 * trusted, and the comparison is timing-safe so the digest cannot be probed
 * byte by byte.
 */
export function verifyOtpToken(
  token: string | undefined,
  expectedPhone: string,
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
    typeof payload.phone !== "string" ||
    typeof payload.exp !== "number" ||
    !payload.phone
  ) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp * 1000 <= now) return { valid: false, reason: "expired" };

  // The binding check. A validly-signed, unexpired token for +974...111 must not
  // authorise a booking for +974...222.
  if (payload.phone !== expectedPhone) {
    return { valid: false, reason: "phone_mismatch" };
  }

  return { valid: true, phone: payload.phone, expiresAt: payload.exp * 1000 };
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

import "server-only";

import { sql } from "@/db/client";
import parsePhoneNumberFromString from "libphonenumber-js/min";
import {
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  generateCode,
  hashCode,
  verifyCode,
} from "./code";
import { createOtpChannel, OtpDeliveryError } from "./index";

/**
 * The OTP use-cases, kept out of the route handlers so the tests can drive them
 * directly without an HTTP server.
 */

export type SendOutcome =
  | { ok: true; expiresInSeconds: number; devCode?: string }
  | { ok: false; reason: RateLimitReason; retryAfter: number }
  | { ok: false; reason: "delivery_failed"; retryAfter: number };

export type RateLimitReason =
  "per_phone_cooldown" | "per_phone_hourly" | "per_ip_hourly" | "per_ip_phones";

export type VerifyOutcome =
  | { ok: true; phone: string }
  | {
      ok: false;
      reason: "no_code" | "expired" | "wrong_code" | "too_many_attempts";
      attemptsRemaining?: number;
    };

/** Normalises to E.164, or null if the number is not real. */
export function normalisePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim());
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * True only when it is safe to echo the code back to the caller.
 *
 * Both conditions are required and neither is enough alone: the flag exists for
 * automated tests and offline development, and a production deployment that
 * happened to inherit OTP_DEV_ECHO=true must still never leak a code.
 */
export function devEchoEnabled(): boolean {
  return (
    process.env.OTP_DEV_ECHO === "true" && process.env.NODE_ENV !== "production"
  );
}

/**
 * Issues and delivers a code.
 *
 * Order of operations is deliberate. The rate-limit check and the row insert
 * happen first, atomically, in `request_otp()`. Delivery comes after. That means
 * a WhatsApp outage consumes the customer's quota — the alternative (insert only
 * after a successful send) would let an attacker probe indefinitely by inducing
 * delivery failures, and would reopen the concurrency hole the SQL function
 * exists to close.
 */
export async function sendOtp(params: {
  phone: string;
  locale: "ar" | "en";
  ip: string | null;
}): Promise<SendOutcome> {
  const { phone, locale, ip } = params;

  const code = generateCode();
  const codeHash = await hashCode(code);

  const rows = await sql<
    {
      allowed: boolean;
      reason: string;
      retry_after: number;
      otp_id: string | null;
    }[]
  >`
    SELECT * FROM request_otp(
      ${phone}, ${codeHash}, ${ip}::inet, ${CODE_TTL_SECONDS}
    )
  `;

  const verdict = rows[0];
  if (!verdict?.allowed) {
    return {
      ok: false,
      reason: (verdict?.reason ?? "per_phone_cooldown") as RateLimitReason,
      retryAfter: verdict?.retry_after ?? 60,
    };
  }

  try {
    await createOtpChannel().send(phone, code, locale);
  } catch (error) {
    const retryable = error instanceof OtpDeliveryError && error.retryable;
    console.error("[otp] delivery failed", {
      phone: redactPhone(phone),
      retryable,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      reason: "delivery_failed",
      retryAfter: retryable ? 15 : 60,
    };
  }

  return {
    ok: true,
    expiresInSeconds: CODE_TTL_SECONDS,
    ...(devEchoEnabled() ? { devCode: code } : {}),
  };
}

/**
 * Checks a submitted code.
 *
 * The whole read-compare-write runs in one transaction with the row locked
 * FOR UPDATE, so two simultaneous guesses cannot both see "attempts = 4" and
 * each get a free try. The bcrypt comparison happens inside that transaction —
 * it is the reason this cannot be a pure SQL function.
 */
export async function verifyOtp(params: {
  phone: string;
  code: string;
}): Promise<VerifyOutcome> {
  const { phone, code } = params;

  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        code_hash: string;
        attempts: number;
        expired: boolean;
      }[]
    >`
      SELECT id, code_hash, attempts, (expires_at <= now()) AS expired
        FROM otp_verifications
       WHERE phone = ${phone}
         AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE
    `;

    const row = rows[0];
    if (!row) return { ok: false, reason: "no_code" } as const;
    if (row.expired) return { ok: false, reason: "expired" } as const;

    // Already at the cap: burn it rather than allowing an extra guess.
    if (row.attempts >= MAX_ATTEMPTS) {
      await tx`
        UPDATE otp_verifications SET expires_at = now() WHERE id = ${row.id}
      `;
      return { ok: false, reason: "too_many_attempts" } as const;
    }

    const matches = await verifyCode(code, row.code_hash);

    if (!matches) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await tx`
        UPDATE otp_verifications
           SET attempts = ${attempts},
               expires_at = CASE WHEN ${exhausted} THEN now() ELSE expires_at END
         WHERE id = ${row.id}
      `;
      return exhausted
        ? ({ ok: false, reason: "too_many_attempts" } as const)
        : ({
            ok: false,
            reason: "wrong_code",
            attemptsRemaining: MAX_ATTEMPTS - attempts,
          } as const);
    }

    await tx`
      UPDATE otp_verifications
         SET consumed_at = now(), attempts = ${row.attempts + 1}
       WHERE id = ${row.id}
    `;
    return { ok: true, phone } as const;
  });
}

/** Keeps full numbers out of logs while staying useful for support. */
export function redactPhone(phone: string): string {
  return phone.length <= 5
    ? "***"
    : `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

/**
 * Best-effort client IP.
 *
 * Trusts x-forwarded-for only because Vercel (and any sane proxy) overwrites it
 * at the edge. Behind a proxy that does NOT, this header is attacker-controlled
 * and the IP limits become advisory — which is why the per-phone limits, which
 * cannot be spoofed this way, are the primary defence.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

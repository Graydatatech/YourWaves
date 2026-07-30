import { z } from "zod";
import { clientIp, normalisePhone, sendOtp } from "@/lib/otp/service";

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(24),
  locale: z.enum(["ar", "en"]).default("ar"),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/otp/send  { phone, locale }
 *
 * Two properties matter more than the happy path:
 *
 * 1. THE CODE IS NEVER IN THE RESPONSE. The only exception is
 *    OTP_DEV_ECHO=true with NODE_ENV !== "production", which `devEchoEnabled()`
 *    enforces as an AND — a production build that inherited the flag still
 *    leaks nothing.
 *
 * 2. NOTHING HERE REVEALS WHETHER A NUMBER IS KNOWN. Every outcome for a
 *    well-formed number is shaped identically, and rate-limit responses say only
 *    "too many requests" plus when to retry. An endpoint that answered
 *    differently for a number that has booked before would be a customer-list
 *    oracle for anyone willing to iterate.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: NO_STORE },
    );
  }

  const phone = normalisePhone(parsed.data.phone);
  if (!phone) {
    return Response.json(
      { error: "invalid_phone" },
      { status: 422, headers: NO_STORE },
    );
  }

  const outcome = await sendOtp({
    phone,
    locale: parsed.data.locale,
    ip: clientIp(request),
  });

  if (!outcome.ok) {
    if (outcome.reason === "delivery_failed") {
      // 502: our upstream failed. Distinct from a rate limit so the client can
      // offer "try again" rather than a countdown.
      return Response.json(
        { error: "delivery_failed", retry_after: outcome.retryAfter },
        {
          status: 502,
          headers: { ...NO_STORE, "Retry-After": String(outcome.retryAfter) },
        },
      );
    }

    return Response.json(
      {
        error: "rate_limited",
        // The specific limit is returned so the UI can phrase the wait
        // correctly; it says nothing about whether the number exists.
        limit: outcome.reason,
        retry_after: outcome.retryAfter,
      },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(outcome.retryAfter) },
      },
    );
  }

  return Response.json(
    {
      ok: true,
      expires_in: outcome.expiresInSeconds,
      // Present ONLY under OTP_DEV_ECHO in a non-production build.
      ...(outcome.devCode ? { dev_code: outcome.devCode } : {}),
    },
    { status: 200, headers: NO_STORE },
  );
}

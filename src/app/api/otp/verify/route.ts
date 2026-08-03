import { z } from "zod";
import { cookies } from "next/headers";
import { normaliseDestination, verifyOtp } from "@/lib/otp/service";
import { otpTarget } from "@/lib/otp";
import { looksLikeCode, CODE_LENGTH } from "@/lib/otp/code";
import {
  OTP_COOKIE_NAME,
  TOKEN_TTL_SECONDS,
  cookieOptions,
  issueOtpToken,
} from "@/lib/otp/token";

const bodySchema = z.object({
  destination: z.string().trim().min(3).max(160).optional(),
  phone: z.string().trim().min(3).max(160).optional(),
  code: z.string().trim().length(CODE_LENGTH),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/otp/verify  { destination, code }
 *
 * On success, issues a 30-minute HttpOnly cookie proving THIS contact was
 * verified. Phases 5 and 6 require it before acting on a booking.
 *
 * The token carries the subject and `verifyOtpToken()` is always called
 * with the contact being acted on, so a token earned for one contact cannot
 * confirm a booking for another.
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

  const target = otpTarget();
  const supplied = parsed.data.destination ?? parsed.data.phone ?? "";
  const destination = normaliseDestination(supplied, target);
  if (!destination) {
    return Response.json(
      { error: target === "email" ? "invalid_email" : "invalid_phone" },
      { status: 422, headers: NO_STORE },
    );
  }

  // Cheap shape check first, so junk never costs a bcrypt comparison. This is
  // not a security boundary — the attempt counter is — it just avoids burning an
  // attempt on input that could not possibly be a code.
  if (!looksLikeCode(parsed.data.code)) {
    return Response.json(
      { error: "wrong_code" },
      { status: 400, headers: NO_STORE },
    );
  }

  const outcome = await verifyOtp({ destination, code: parsed.data.code });

  if (!outcome.ok) {
    const status =
      outcome.reason === "too_many_attempts"
        ? 429
        : outcome.reason === "expired" || outcome.reason === "no_code"
          ? 410 // Gone: the code existed (or never did) but cannot be used now.
          : 400;

    return Response.json(
      {
        error: outcome.reason,
        ...(outcome.attemptsRemaining !== undefined
          ? { attempts_remaining: outcome.attemptsRemaining }
          : {}),
      },
      { status, headers: NO_STORE },
    );
  }

  // `cookies()` is async in Next 16.
  const jar = await cookies();
  jar.set(
    OTP_COOKIE_NAME,
    issueOtpToken(destination),
    cookieOptions(TOKEN_TTL_SECONDS),
  );

  return Response.json(
    {
      ok: true,
      destination,
      // So the client can show the verification lapsing without decoding a
      // cookie it deliberately cannot read.
      expires_in: TOKEN_TTL_SECONDS,
    },
    { status: 200, headers: NO_STORE },
  );
}

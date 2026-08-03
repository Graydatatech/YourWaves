import { cookies } from "next/headers";
import { bookingRequestSchema, toE164 } from "@/lib/booking/schema";
import { createHold, type HoldErrorCode } from "@/lib/booking/holds";
import { OTP_COOKIE_NAME, verifyOtpToken } from "@/lib/otp/token";
import { BOOKING_FORM } from "@/lib/booking/formConfig";
import { verificationSubject } from "@/lib/otp";
import { hasTerms } from "@/lib/booking/terms";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/bookings/hold
 *
 * Locks the date for settings.hold_minutes and returns the hold. A hold ends at
 * "ready to pay" — no gateway is contacted here.
 *
 * Everything that decides whether the hold is granted happens inside one
 * Postgres transaction in `create_booking_hold()`: the per-date advisory lock,
 * then the availability re-check under that lock, then the insert, with the
 * partial unique index as the final backstop. This handler's only jobs are
 * authorisation and translating a result code into HTTP.
 *
 * Which HTTP status maps to which code is deliberate:
 *   409 for DATE_TAKEN — a genuine conflict; the client should re-fetch the
 *       calendar and let the customer pick again.
 *   422 for everything else — the request described a date that was never
 *       bookable (past, too soon, blacked out, bad slot). Retrying it unchanged
 *       will fail identically, so it is not a conflict.
 * Neither is ever a 500. A lost race is normal operation, not a fault.
 */
const STATUS_FOR: Record<HoldErrorCode, number> = {
  DATE_TAKEN: 409,
  DATE_BLACKOUT: 422,
  DATE_PAST: 422,
  DATE_TOO_SOON: 422,
  DATE_OUT_OF_RANGE: 422,
  INVALID_START_TIME: 422,
  SETTINGS_MISSING: 503,
};

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

  const parsed = bookingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "validation_failed",
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.message,
        })),
      },
      { status: 422, headers: NO_STORE },
    );
  }

  const draft = parsed.data;

  // --- Phase 4 verification, bound to this exact number -------------------
  const submittedPhone = toE164(draft.dialCode, draft.phoneNational);
  if (!submittedPhone) {
    return Response.json(
      {
        error: "validation_failed",
        fields: [{ path: "phoneNational", code: "invalid_phone" }],
      },
      { status: 422, headers: NO_STORE },
    );
  }

  // Gated by the flag the form reads, so hiding the verification step cannot
  // leave the endpoint that actually TAKES the booking demanding a token the
  // customer was never given a way to earn. See @/lib/booking/formConfig.
  if (BOOKING_FORM.contactVerification) {
    // Whichever contact the active channel can actually reach — see
    // verificationSubject. A code emailed to an inbox proves the inbox.
    const subject = verificationSubject({
      phone: submittedPhone,
      email: draft.customerEmail,
    });
    const jar = await cookies();
    const verdict = subject
      ? verifyOtpToken(jar.get(OTP_COOKIE_NAME)?.value, subject)
      : ({ valid: false, reason: "malformed" } as const);
    if (!verdict.valid) {
      return Response.json(
        { error: "phone_not_verified", reason: verdict.reason },
        { status: 403, headers: NO_STORE },
      );
    }
  }

  /**
   * --- The terms tick ----------------------------------------------------
   *
   * Asked of the DATABASE, not of the request. The client tells us whether it
   * rendered a checkbox; that is a hint about what the customer saw, not a fact
   * about what is required, and a request that simply omits `termsAccepted`
   * must not thereby escape the requirement.
   *
   * Only enforced when terms actually exist. A business that has not written
   * them yet gets a booking form with no tick and a server that does not
   * demand one — the same both-sides-agree property as the phone verification
   * flag above, and for the same reason: a gate the UI cannot satisfy refuses
   * every customer.
   */
  if ((await hasTerms()) && draft.termsAccepted !== true) {
    return Response.json(
      { error: "terms_not_accepted" },
      { status: 422, headers: NO_STORE },
    );
  }

  // --- Claim the date ----------------------------------------------------
  const result = await createHold({ ...draft, customerPhone: submittedPhone });

  if (!result.ok) {
    return Response.json(
      {
        error: "hold_refused",
        // The client maps this to a bilingual message via
        // booking.holdErrors.<code>; the server sends no prose.
        code: result.code,
      },
      { status: STATUS_FOR[result.code], headers: NO_STORE },
    );
  }

  return Response.json(
    {
      ok: true,
      bookingId: result.bookingId,
      reference: result.reference,
      holdExpiresAt: result.holdExpiresAt,
      priceTotal: result.priceTotal,
      currency: result.currency,
    },
    { status: 201, headers: NO_STORE },
  );
}

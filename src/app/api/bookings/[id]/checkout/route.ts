import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/db/client";
import { startCheckout, type CheckoutRefusal } from "@/lib/payments/service";
import { OTP_COOKIE_NAME, verifyOtpToken } from "@/lib/otp/token";
import { BOOKING_FORM } from "@/lib/booking/formConfig";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ locale: z.enum(["ar", "en"]).default("ar") });

/**
 * POST /api/bookings/[id]/checkout
 *
 * Valid only while the booking is 'holding' and the hold has not expired.
 *
 * The response is a redirect URL, not a redirect: the client navigates in the
 * SAME TAB. Opening a payment page in a new window loses context in iOS Safari —
 * the customer ends up on a blank tab with no way back and assumes the payment
 * broke.
 *
 * NOTE: the amount is NOT in the request body and would be ignored if it were.
 * It is recomputed from the booking row, which was priced from `settings` when
 * the hold was taken.
 */
const STATUS_FOR: Record<CheckoutRefusal, number> = {
  NOT_FOUND: 404,
  NOT_HOLDING: 409,
  HOLD_EXPIRED: 409,
  ALREADY_PAID: 409,
  // 503, not 502: nothing is wrong upstream, WE are not set up. The distinction
  // matters to anything reading these logs — 502 invites you to go and look at
  // the gateway, which is exactly the wrong place.
  NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const locale = body.success ? body.data.locale : "ar";

  const owner = await sql<{ customer_phone: string }[]>`
    SELECT customer_phone FROM bookings WHERE id = ${resolved.data.id}::uuid
  `;
  const phone = owner[0]?.customer_phone;

  if (!phone) {
    return Response.json(
      { error: "not_found", code: "NOT_FOUND" },
      { status: 404, headers: NO_STORE },
    );
  }

  /**
   * Authorisation: the phase-4 token, matched against the booking's own phone.
   *
   * GATED BY THE SAME FLAG THE FORM READS, like /api/bookings and
   * /api/bookings/hold. This route and /release were missed when the flag was
   * introduced, and the consequence was total: with `phoneVerification: false`
   * the wizard never renders the OTP step, so no cookie is ever issued, so this
   * endpoint refused EVERY payment with a 403. A customer could book and hold a
   * date and then never pay for it — the product's whole revenue path, dead, in
   * the configuration the project was actually running in.
   *
   * If a gate is behind a flag, every gate on the same path has to be.
   */
  if (BOOKING_FORM.phoneVerification) {
    const jar = await cookies();
    const token = jar.get(OTP_COOKIE_NAME)?.value;

    if (!token) {
      /**
       * `code` as well as `error`, and this is not cosmetic.
       *
       * useCheckout reads `body.code` and falls back to PROVIDER_ERROR when it
       * is absent — so this 403 reached the customer as "our payment provider
       * is not responding", naming the one component that had not been
       * contacted and implying a retry that cannot work.
       *
       * The verification cookie lasts 30 minutes while the hold survives in
       * sessionStorage, so this is a NORMAL state once the flag is on: leave
       * the tab open through a slow checkout and the token lapses under a live
       * Pay button.
       */
      return Response.json(
        { error: "phone_not_verified", code: "PHONE_NOT_VERIFIED" },
        { status: 403, headers: NO_STORE },
      );
    }

    if (!verifyOtpToken(token, phone).valid) {
      // Same answer for "no such booking" and "not yours", so an id cannot be
      // used to probe which bookings exist. NOT_FOUND rather than
      // PHONE_NOT_VERIFIED for the same reason: a token that fails to verify
      // must not be distinguishable from a booking that is not there.
      return Response.json(
        { error: "not_found", code: "NOT_FOUND" },
        { status: 404, headers: NO_STORE },
      );
    }
  }

  const origin = new URL(request.url).origin;
  const result = await startCheckout({
    bookingId: resolved.data.id,
    phone,
    origin: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || origin,
    locale,
  });

  if (!result.ok) {
    return Response.json(
      { error: "checkout_refused", code: result.code },
      { status: STATUS_FOR[result.code], headers: NO_STORE },
    );
  }

  return Response.json(
    {
      ok: true,
      redirectUrl: result.redirectUrl,
      // Echoed so the UI can show what is about to be charged. Informational —
      // the provider was already told the authoritative figure.
      amount: result.amount,
    },
    { status: 200, headers: NO_STORE },
  );
}

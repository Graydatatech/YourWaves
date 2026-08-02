import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/db/client";
import { startCheckout, type CheckoutRefusal } from "@/lib/payments/service";
import { OTP_COOKIE_NAME, verifyOtpToken } from "@/lib/otp/token";

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

  // Authorisation: the phase-4 token, matched against the booking's own phone.
  const jar = await cookies();
  const token = jar.get(OTP_COOKIE_NAME)?.value;
  if (!token) {
    /**
     * `code` as well as `error`, and this is not cosmetic.
     *
     * useCheckout reads `body.code` and falls back to PROVIDER_ERROR when it is
     * absent — so this 403 used to reach the customer as "our payment provider
     * is not responding". That is worse than unhelpful: it is a lie that points
     * at the one component which was never contacted, and the only recovery it
     * suggests is retrying the payment, which cannot work. The actual fix is to
     * verify the phone again.
     *
     * It cost real debugging time on the deployed site — a 403 with `22ms` and
     * "no outgoing requests" in the Vercel log, while the screen blamed
     * SkipCash.
     *
     * The verification cookie lasts 30 minutes and the hold survives in
     * sessionStorage, so this is a NORMAL state to end up in: leave the tab
     * open through a long checkout and the token lapses under a live Pay
     * button.
     */
    return Response.json(
      { error: "phone_not_verified", code: "PHONE_NOT_VERIFIED" },
      { status: 403, headers: NO_STORE },
    );
  }

  const owner = await sql<{ customer_phone: string }[]>`
    SELECT customer_phone FROM bookings WHERE id = ${resolved.data.id}::uuid
  `;
  const phone = owner[0]?.customer_phone;
  if (!phone || !verifyOtpToken(token, phone).valid) {
    // Same answer for "no such booking" and "not yours", so an id cannot be
    // used to probe which bookings exist. NOT_FOUND rather than
    // PHONE_NOT_VERIFIED for the same reason: a token that fails to verify
    // must not be distinguishable from a booking that is not there.
    return Response.json(
      { error: "not_found", code: "NOT_FOUND" },
      { status: 404, headers: NO_STORE },
    );
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

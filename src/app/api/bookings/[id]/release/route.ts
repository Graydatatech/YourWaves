import { cookies } from "next/headers";
import { z } from "zod";
import { getHold, releaseHold } from "@/lib/booking/holds";
import { OTP_COOKIE_NAME, verifyOtpToken } from "@/lib/otp/token";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/bookings/[id]/release — the customer backed out.
 *
 * Authorisation is the verification token, and the booking's phone must match
 * the token's. A booking id is a uuid that travels through a browser; on its own
 * it must never be enough to cancel a hold.
 *
 * NOT_FOUND and FORBIDDEN both answer 404 with the same body. Distinguishing
 * them would turn this endpoint into an oracle for "does this booking id
 * exist?", which is not information a stranger should be able to obtain.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // `params` is a Promise in Next 16.
  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }
  const bookingId = resolved.data.id;

  const jar = await cookies();
  const token = jar.get(OTP_COOKIE_NAME)?.value;
  if (!token) {
    return Response.json(
      { error: "phone_not_verified" },
      { status: 403, headers: NO_STORE },
    );
  }

  // The token's phone is the identity. Read the booking under that phone, so a
  // mismatched pair is simply "not found".
  //
  // Decoding the phone from the token without knowing it up front: verify
  // against the booking's own phone, which requires reading the booking first —
  // so read it by id, then check the token against the phone we found.
  const existing = await getHoldByIdForToken(bookingId, token);
  if (!existing) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const result = await releaseHold(bookingId, existing.phone);

  if (!result.ok) {
    if (result.code === "NOT_HOLDING") {
      return Response.json(
        { error: "not_holding" },
        { status: 409, headers: NO_STORE },
      );
    }
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true }, { status: 200, headers: NO_STORE });
}

/**
 * Resolves the booking only if the caller's token attests to its phone.
 *
 * Done in two steps because the token carries the phone and the booking stores
 * it: read the booking, then require the token to be valid FOR THAT phone. A
 * token for another number therefore cannot reach this booking at all.
 */
async function getHoldByIdForToken(
  bookingId: string,
  token: string,
): Promise<{ phone: string } | null> {
  const { sql } = await import("@/db/client");
  const rows = await sql<{ customer_phone: string }[]>`
    SELECT customer_phone FROM bookings WHERE id = ${bookingId}::uuid
  `;
  const phone = rows[0]?.customer_phone;
  if (!phone) return null;

  const verdict = verifyOtpToken(token, phone);
  return verdict.valid ? { phone } : null;
}

/**
 * GET /api/bookings/[id]/release is not meaningful, but a GET on the parent
 * booking is: the countdown needs to resynchronise after a reload or a language
 * switch. That lives here to keep the hold surface in one file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const jar = await cookies();
  const token = jar.get(OTP_COOKIE_NAME)?.value;
  if (!token) {
    return Response.json(
      { error: "phone_not_verified" },
      { status: 403, headers: NO_STORE },
    );
  }

  const owner = await getHoldByIdForToken(resolved.data.id, token);
  if (!owner) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const snapshot = await getHold(resolved.data.id, owner.phone);
  if (!snapshot) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  return Response.json(snapshot, { status: 200, headers: NO_STORE });
}

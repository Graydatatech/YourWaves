import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { transitionBooking } from "@/lib/admin/mutations";
import type { BookingStatus } from "@/lib/admin/types";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  to: z.enum([
    "holding",
    "pending",
    "confirmed",
    "assigned",
    "en_route",
    "completed",
    "cancelled",
    "expired",
  ]),
  reason: z.string().trim().max(300).optional(),
});

/**
 * POST /api/admin/bookings/[reference]/transition
 *
 * The only way the back office moves a booking.
 *
 * The UI only renders buttons for legal transitions, but that is a convenience,
 * not the control. This endpoint re-derives what is legal and the SQL function
 * behind it raises on anything else — so a hand-written POST asking to jump
 * `confirmed → completed` is refused with 409 and the booking does not move.
 *
 * The customer's status notification is queued by the 0007 trigger inside the
 * same transaction, so a transition that commits always has its message and one
 * that fails never does.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { reference } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await transitionBooking(
    auth,
    reference,
    parsed.data.to as BookingStatus,
    { reason: parsed.data.reason },
  );

  if (result.ok) {
    return Response.json(
      { ok: true, status: result.status },
      { headers: NO_STORE },
    );
  }

  if (result.code === "not_found") {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  if (result.code === "illegal_transition") {
    return Response.json(
      {
        error: "illegal_transition",
        from: result.from,
        requested: parsed.data.to,
        allowed: result.allowed,
      },
      { status: 409, headers: NO_STORE },
    );
  }

  return Response.json(
    { error: "transition_failed" },
    { status: 500, headers: NO_STORE },
  );
}

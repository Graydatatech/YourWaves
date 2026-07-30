import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { assignDriver } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const bodySchema = z.object({ driverId: z.string().uuid() });

/**
 * POST /api/admin/bookings/[reference]/assign — driver dispatch (SRS 3.3).
 *
 * Assigning a driver to a confirmed booking also moves it to `assigned`, which
 * is what fires the customer's "your crew is confirmed" message and the
 * driver's job sheet. All of that happens inside `assign_driver()` in one
 * transaction: a booking is never left with a driver but no notification.
 *
 * Reassignment is allowed and notifies the outgoing driver too.
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

  const result = await assignDriver(auth, reference, parsed.data.driverId);

  // A refusal is normal operation, not a fault: the job may have finished while
  // the dispatcher had the screen open.
  const STATUS: Record<string, number> = {
    ASSIGNED: 200,
    REASSIGNED: 200,
    UNCHANGED: 200,
    BOOKING_NOT_FOUND: 404,
    DRIVER_NOT_FOUND: 404,
    DRIVER_INACTIVE: 409,
    BOOKING_NOT_DISPATCHABLE: 409,
  };

  const status = STATUS[result.outcome] ?? 500;

  return Response.json(
    {
      ok: status === 200,
      outcome: result.outcome,
      status: result.status,
      previousDriver: result.previousDriver,
    },
    { status, headers: NO_STORE },
  );
}

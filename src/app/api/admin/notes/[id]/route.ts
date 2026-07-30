import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { deleteBookingNote } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * DELETE /api/admin/notes/[id]
 *
 * Notes are deletable; `booking_events` is not. That separation is the reason
 * they are different tables — removing a note must never punch a hole in the
 * audit trail.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const result = await deleteBookingNote(auth, parsed.data.id);
  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

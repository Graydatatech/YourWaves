import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { revokeDispatch } from "@/lib/admin/dispatch";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * DELETE /api/admin/dispatch/[id] — revoke ONE recipient's link.
 *
 * Individual by design: taking the supervisor's access away must leave the
 * driver's working, which is the whole reason each recipient gets their own
 * token rather than sharing one per booking.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const result = await revokeDispatch(auth, id);
  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

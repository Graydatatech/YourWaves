import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { revokeAdminUser } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ userId: z.string().uuid() });

const STATUS_FOR = {
  not_found: 404,
  cannot_revoke_self: 409,
  last_admin: 409,
} as const;

/**
 * DELETE /api/admin/admins/[userId] — remove back-office access.
 *
 * Deletes the `user_roles` row, not the auth account. The role is read on every
 * request (§4h), so this takes effect on the revoked person's very next query
 * rather than whenever their token happens to expire — which is the property
 * that makes revocation meaningful.
 *
 * The two refusals are enforced in the mutation, not here and not in the UI:
 * revoking yourself, and revoking the last remaining admin. A hand-written
 * DELETE would sail past a disabled button, and the failure mode is nobody
 * being able to reach the back office at all.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const result = await revokeAdminUser(auth, resolved.data.userId);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.code },
      { status: STATUS_FOR[result.code], headers: NO_STORE },
    );
  }

  console.info("[admin] admin access revoked", {
    by: auth.userId,
    userId: resolved.data.userId,
  });

  return Response.json({ ok: true }, { headers: NO_STORE });
}

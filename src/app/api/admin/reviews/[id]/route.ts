import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { deleteReview, setReviewPublished } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });
const patchSchema = z.object({ isPublished: z.boolean() });

/** PATCH /api/admin/reviews/[id] — publish or unpublish. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await setReviewPublished(
    auth,
    resolved.data.id,
    parsed.data.isPublished,
  );

  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

/** DELETE /api/admin/reviews/[id] — remove a comment entirely. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
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

  const result = await deleteReview(auth, resolved.data.id);
  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

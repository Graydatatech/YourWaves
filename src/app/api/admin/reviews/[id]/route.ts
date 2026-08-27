import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import {
  deleteReview,
  setReviewPublished,
  setReviewTranslation,
} from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });
/**
 * Both fields optional, at least one required.
 *
 * Publishing and translating are separate acts on the same row and the panel
 * posts them separately — a schema that demanded both would mean the publish
 * toggle had to send a translation it does not know about, and overwrite it.
 */
const patchSchema = z
  .object({
    isPublished: z.boolean().optional(),
    translation: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.isPublished !== undefined || v.translation !== undefined,
    { message: "nothing_to_change" },
  );

/** PATCH /api/admin/reviews/[id] — publish, unpublish, or save a translation. */
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

  // Translation first: if both arrive together, the row should be translated
  // by the time it is visible rather than a moment after.
  let ok = true;
  if (parsed.data.translation !== undefined) {
    ok = (
      await setReviewTranslation(auth, resolved.data.id, parsed.data.translation)
    ).ok;
  }
  let reason: string | undefined;
  if (ok && parsed.data.isPublished !== undefined) {
    const result = await setReviewPublished(
      auth,
      resolved.data.id,
      parsed.data.isPublished,
    );
    ok = result.ok;
    reason = result.reason;
  }

  // 409, not 404: "the customer did not agree to this" is a state, not a
  // missing row, and the panel needs to tell them apart to say why.
  const status = ok ? 200 : reason === "not_found" || !reason ? 404 : 409;
  return Response.json({ ok, error: reason }, { status, headers: NO_STORE });
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

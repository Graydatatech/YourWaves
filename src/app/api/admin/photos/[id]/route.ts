import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { readDispatchPhoto } from "@/lib/admin/dispatch";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/admin/photos/[id] — the bytes of one completion photo.
 *
 * Behind `requireAdmin` like every other admin route, and read through `asUser`
 * so the RLS policy on booking_dispatch_photos is what actually decides. There
 * is no token path to this: a driver uploads a photo and never sees it again,
 * which keeps a leaked dispatch link from becoming a window onto other jobs'
 * pictures.
 *
 * `Content-Disposition: inline` with a fixed nosniff header: the stored MIME is
 * constrained to three raster formats by a CHECK constraint, and the browser is
 * told not to second-guess it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const photo = await readDispatchPhoto(auth, id);
  if (!photo) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  return new Response(new Uint8Array(photo.image), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ...NO_STORE,
    },
  });
}

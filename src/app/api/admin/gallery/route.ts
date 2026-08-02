import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin/session";
import { GALLERY_BUCKET } from "@/lib/site/gallery";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * 3 MiB. The browser compresses to roughly 200-500KB before sending, so this is
 * a backstop against a hand-crafted request rather than a limit anybody meets.
 * It also sits under Vercel's serverless body ceiling, which is the real
 * constraint and one that fails with an opaque error if you cross it.
 */
const MAX_BYTES = 3 * 1024 * 1024;

/** Raster only. An SVG is a script; it has no business in a public gallery. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The Storage client, service role.
 *
 * WHY THE UPLOAD GOES THROUGH US rather than straight from the browser to
 * Supabase: a direct upload needs a Storage RLS policy granting insert to
 * authenticated users, which is a second place authorisation lives and a second
 * thing to get wrong. Routing it through here keeps the question "may this
 * person do this?" in `requireAdmin()`, where every other admin write already
 * answers it, and the service role bypasses Storage policies entirely so the
 * bucket needs no configuration beyond existing and being public.
 *
 * The cost is that the bytes cross our function. That is affordable because
 * the browser compresses first — see GalleryPanel.
 */
function storageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/admin/gallery — upload one image, return its storage path.
 *
 * Returns the PATH, not a URL. The caller puts it in the settings array and the
 * public URL is derived at render, so the project reference is never baked into
 * stored data (migration 0017).
 *
 * Uploading does not publish: the image only appears on the site once the
 * settings row is saved with its path. That separation is deliberate — it means
 * an interrupted upload leaves an orphan object in the bucket rather than a
 * half-added image on the marketing page.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const supabase = storageClient();
  if (!supabase) {
    return Response.json(
      {
        ok: false,
        error: "not_configured",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is not set, so uploads cannot reach " +
          "Storage. See docs/admin-setup.md.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return Response.json(
      { ok: false, error: "no_file" },
      { status: 422, headers: NO_STORE },
    );
  }

  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { ok: false, error: "bad_type" },
      { status: 415, headers: NO_STORE },
    );
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      { ok: false, error: "too_large" },
      { status: 413, headers: NO_STORE },
    );
  }

  /**
   * A generated name, never the uploaded one. A filename from a browser is
   * attacker-influenced text: it can carry path separators, unicode that
   * normalises to something else, or simply collide with an existing object and
   * overwrite it. A uuid collides with nothing and reveals nothing.
   */
  const path = `${randomUUID()}.${EXTENSION[file.type]}`;

  const { error } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      // A year: the name is a uuid, so the bytes at a given path never change.
      cacheControl: "31536000",
      upsert: false,
    });

  if (error) {
    console.error("[admin/gallery] upload failed", { message: error.message });
    return Response.json(
      { ok: false, error: "upload_failed", message: error.message },
      { status: 502, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true, path }, { status: 201, headers: NO_STORE });
}

/**
 * DELETE /api/admin/gallery?path=… — remove an object from the bucket.
 *
 * Called after the settings row has been saved without it. Doing it in that
 * order means a failure here leaves an unreferenced object in the bucket, which
 * costs a few kilobytes; the other order would leave the page pointing at bytes
 * that no longer exist, which costs a broken image.
 */
export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const supabase = storageClient();
  if (!supabase) {
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const path = new URL(request.url).searchParams.get("path") ?? "";

  // Only ever a bare uuid.ext — the shape POST creates. Anything with a slash
  // or a traversal segment is refused rather than handed to Storage.
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path)) {
    return Response.json(
      { ok: false, error: "bad_path" },
      { status: 422, headers: NO_STORE },
    );
  }

  const { error } = await supabase.storage.from(GALLERY_BUCKET).remove([path]);

  if (error) {
    console.error("[admin/gallery] delete failed", { message: error.message });
    return Response.json(
      { ok: false, error: "delete_failed" },
      { status: 502, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true }, { headers: NO_STORE });
}

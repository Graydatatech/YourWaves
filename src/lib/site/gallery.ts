import "server-only";

import { sql } from "@/db/client";
import type { Locale } from "@/i18n/routing";

/**
 * Gallery images, with the committed placeholder art as the floor.
 *
 * The bytes live in Supabase Storage; the settings row holds only the object
 * PATH and the alt text. The public URL is derived here rather than stored, so
 * a restore into a different Supabase project — or a custom storage domain
 * later — does not break every image with no fix short of a data migration.
 */

export const GALLERY_BUCKET = "gallery";

/**
 * The designed tile shapes.
 *
 * Still declared here rather than measured from the uploads, and that is the
 * CLS guarantee from phase 10: every tile reserves its exact box before the
 * image loads, so a late arrival cannot reflow the masonry column beneath it.
 * An uploaded photo is cropped to the tile with object-cover, which is what
 * already happens to the placeholder art.
 */
export const TILE_RATIOS = [
  "3/4",
  "4/3",
  "1/1",
  "8/5",
  "4/5",
  "4/3",
] as const;

export type GalleryTile = {
  /** Absolute URL for uploads, or a root-relative path for the fallback art. */
  src: string;
  alt: string;
  ratio: string;
  /**
   * Present only for the committed placeholder art, where a static import
   * generates it at build time. An uploaded image is just a URL — producing a
   * placeholder for one would mean decoding it on the server on every render,
   * for a tile that is below the fold anyway.
   */
  blurDataURL?: string;
};

type StoredImage = { path?: unknown; altEn?: unknown; altAr?: unknown };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}` — the public URL
 * shape for a public bucket. Encoded per segment so a filename with a space
 * does not produce a broken URL.
 */
export function publicUrlFor(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!base || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${GALLERY_BUCKET}/${encoded}`;
}

export async function getGallery(
  locale: Locale,
  fallback: GalleryTile[],
): Promise<GalleryTile[]> {
  let stored: unknown = [];

  try {
    const rows = await sql<{ gallery: unknown }[]>`
      SELECT gallery FROM settings WHERE id = 1
    `;
    stored = rows[0]?.gallery ?? [];
  } catch {
    // No migration 0017 yet, or a brief outage. The gallery is decorative — it
    // must never be the reason the home page fails to render.
    return fallback;
  }

  if (!Array.isArray(stored) || stored.length === 0) return fallback;

  const tiles = stored
    .map((raw, index): GalleryTile | null => {
      const item = raw as StoredImage;
      const src = publicUrlFor(text(item.path));
      if (!src) return null;

      const altEn = text(item.altEn);
      const altAr = text(item.altAr);

      return {
        src,
        // Arabic falls back to English, English to Arabic, and only then to
        // empty. `alt=""` marks an image decorative, which is the honest
        // answer when nobody has described it — better than "photo 3", which
        // tells a screen-reader user nothing while claiming to.
        alt: (locale === "ar" ? altAr || altEn : altEn || altAr) || "",
        ratio: TILE_RATIOS[index % TILE_RATIOS.length],
      };
    })
    .filter((tile): tile is GalleryTile => tile !== null);

  return tiles.length > 0 ? tiles : fallback;
}

/**
 * The photo contract, shared by the browser that compresses and the route that
 * stores.
 *
 * Deliberately NOT `server-only`: the client needs the same numbers, and a
 * limit the compressor does not know about is a limit the driver discovers by
 * being rejected after a 30-second upload on 4G.
 */

/** Longest edge after compression. A 12MP phone photo becomes ~200KB of JPEG. */
export const PHOTO_MAX_EDGE = 1600;

/** Low enough to be quick on 4G, high enough to show whether the site is tidy. */
export const PHOTO_QUALITY = 0.6;

/**
 * Hard ceiling, matching the CHECK constraint in 0011. The compressor should
 * land two orders of magnitude below this; the cap exists for the case where it
 * silently fails and the original 6MB file is sent instead.
 */
export const PHOTO_MAX_BYTES = 2_097_152;

export const PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/webp",
  "image/png",
] as const;

export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

export function isPhotoMimeType(value: string): value is PhotoMimeType {
  return (PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

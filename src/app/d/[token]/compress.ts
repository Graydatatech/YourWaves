import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_QUALITY,
} from "@/lib/dispatch/photoLimits";

/**
 * Shrinking a phone photo before it leaves the device.
 *
 * A modern phone camera produces 4-8MB. Uploading that from a villa driveway on
 * a weak 4G signal takes tens of seconds and often fails — which, for a driver
 * standing in the sun waiting for a spinner, means the feature does not exist.
 * Resizing to a 1600px long edge at quality 0.6 lands at roughly 150-300KB and
 * still shows plainly whether the setup is finished and the site is tidy.
 *
 * Runs on the device rather than the server on purpose: the bytes we never send
 * are the ones that cannot time out.
 */

export type CompressedPhoto = {
  mimeType: string;
  /** Base64 for the wire and for localStorage. */
  data: string;
  /** An object URL for the preview thumbnail; the caller revokes it. */
  previewUrl: string;
  byteSize: number;
};

export type CompressFailure = "too_large" | "unreadable";

export async function compressPhoto(
  file: File,
): Promise<
  { ok: true; photo: CompressedPhoto } | { ok: false; reason: CompressFailure }
> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC on an older Android, a corrupt file, a "photo" that is a PDF.
    return { ok: false, reason: "unreadable" };
  }

  try {
    const scale = Math.min(
      1,
      PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) return { ok: false, reason: "unreadable" };
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      // JPEG rather than WebP: it is the one format every iOS Safari version in
      // the field can encode, and the size difference here is not worth a
      // silent null from toBlob on an older device.
      canvas.toBlob((result) => resolve(result), "image/jpeg", PHOTO_QUALITY);
    });

    if (!blob) return { ok: false, reason: "unreadable" };
    if (blob.size > PHOTO_MAX_BYTES) return { ok: false, reason: "too_large" };

    return {
      ok: true,
      photo: {
        mimeType: "image/jpeg",
        data: await toBase64(blob),
        previewUrl: URL.createObjectURL(blob),
        byteSize: blob.size,
      },
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Chunked rather than `String.fromCharCode(...bytes)`: spreading a 300KB array
 * into arguments overflows the call stack on Safari.
 */
async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

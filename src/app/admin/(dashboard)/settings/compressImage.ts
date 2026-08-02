/**
 * Shrinking a photo in the browser before it is uploaded.
 *
 * Separate from the dispatch compressor (`app/d/[token]/compress.ts`) rather
 * than shared, because the constraints are opposite. That one optimises for a
 * driver on a weak signal in a driveway: 1600px at quality 0.6, evidence that
 * only has to be legible. These are marketing photographs on the home page, and
 * a visibly soft gallery would undo the point of having one — so the long edge
 * is 1800px at quality 0.82, landing around 200-500KB.
 *
 * Compressing here rather than server-side is what keeps the upload inside
 * Vercel's serverless body limit without anybody having to think about it, and
 * a 6MB phone photo never crosses the network at all.
 */

const MAX_EDGE = 1800;
const QUALITY = 0.82;

/** Hard ceiling after compression; the route enforces the same bound. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export type CompressResult =
  | { ok: true; file: File; previewUrl: string }
  | { ok: false; reason: "unreadable" | "too_large" | "unsupported" };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    image.src = url;
  });
}

export async function compressImage(file: File): Promise<CompressResult> {
  // An SVG is a script and must not reach a public page; anything non-raster is
  // refused here as well as at the route, so the failure is immediate and
  // explained rather than a 415 after an upload.
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
    return { ok: false, reason: "unsupported" };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    // HEIC from an iPhone that Safari will decode and Chrome will not, or a
    // file that is not really an image.
    return { ok: false, reason: "unreadable" };
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, reason: "unreadable" };
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    // JPEG rather than WebP: every browser can ENCODE jpeg, and the delivery
    // format is next/image's decision anyway — it re-encodes to AVIF or WebP
    // per request. Encoding effort here would be thrown away.
    canvas.toBlob((result) => resolve(result), "image/jpeg", QUALITY),
  );

  if (!blob) return { ok: false, reason: "unreadable" };
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };

  return {
    ok: true,
    file: new File([blob], "gallery.jpg", { type: "image/jpeg" }),
    previewUrl: URL.createObjectURL(blob),
  };
}

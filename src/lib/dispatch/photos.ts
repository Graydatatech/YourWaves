import "server-only";

import { sql } from "@/db/client";
import type { DispatchJob } from "./service";
import { PHOTO_MAX_BYTES, isPhotoMimeType } from "./photoLimits";

/**
 * Storing a completion photo.
 *
 * The photo is optional and the status update is not, which is why the two
 * travel as separate requests: a 200KB upload failing on a bad connection must
 * never take "job complete" down with it. They share a `clientActionId` so the
 * office can see which tap the photo belongs to, and so a replayed upload is
 * stored exactly once.
 */

export type PhotoOutcome = "stored" | "duplicate";

export type PhotoRejection = "too_large" | "unsupported_type" | "empty";

export type StorePhotoResult =
  { ok: true; outcome: PhotoOutcome } | { ok: false; reason: PhotoRejection };

/**
 * Validates and stores one photo against a resolved dispatch link.
 *
 * The size is re-checked here rather than trusted from the client, and the
 * CHECK constraint in 0011 re-checks it again — the same belt-and-braces the
 * booking index gets, for the same reason: this is the layer a future admin
 * tool or a hand-written insert would bypass.
 */
export async function storeDispatchPhoto(
  job: DispatchJob,
  clientActionId: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<StorePhotoResult> {
  if (!isPhotoMimeType(mimeType)) {
    return { ok: false, reason: "unsupported_type" };
  }
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > PHOTO_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const inserted = await sql<{ id: string }[]>`
    INSERT INTO booking_dispatch_photos
      (dispatch_id, booking_id, client_action_id, mime_type, byte_size, image)
    VALUES (
      ${job.dispatchId}::uuid, ${job.bookingId}::uuid, ${clientActionId},
      ${mimeType}, ${bytes.byteLength},
      ${Buffer.from(bytes)}
    )
    ON CONFLICT (dispatch_id, client_action_id) DO NOTHING
    RETURNING id
  `;

  // No row means the constraint caught a replay — a success from the device's
  // point of view, and the reason the retry loop terminates.
  return { ok: true, outcome: inserted.length > 0 ? "stored" : "duplicate" };
}

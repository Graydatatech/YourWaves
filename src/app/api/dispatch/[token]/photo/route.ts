import { z } from "zod";
import {
  clientIp,
  resolveDispatchToken,
  type DispatchRefusal,
} from "@/lib/dispatch/service";
import { storeDispatchPhoto } from "@/lib/dispatch/photos";
import { PHOTO_MAX_BYTES } from "@/lib/dispatch/photoLimits";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/dispatch/[token]/photo
 *
 * The optional photo behind "Job complete". Separate from the status endpoint
 * on purpose: the status update is small and must not be lost, the photo is
 * large and may be, so they retry independently. They share `clientActionId`,
 * which ties the photo to the tap it came from and makes a replay idempotent.
 *
 * Base64 in JSON rather than multipart, because the offline queue holds the
 * photo in localStorage between attempts and a string survives that round trip
 * without a Blob to rehydrate.
 */
const bodySchema = z.object({
  clientActionId: z.string().trim().min(8).max(64),
  mimeType: z.string().trim().max(40),
  /**
   * Base64, no data: prefix. Bounded before decoding — 4/3 of the byte cap plus
   * padding — so an oversized payload costs a length check rather than a
   * multi-megabyte allocation.
   */
  data: z
    .string()
    .min(1)
    .max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4),
});

const REFUSAL_STATUS: Record<DispatchRefusal, number> = {
  malformed: 404,
  not_found: 404,
  expired: 410,
  revoked: 410,
  rate_limited: 429,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const resolved = await resolveDispatchToken(
    token,
    {
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    },
    { markOpened: false },
  );

  if (!resolved.ok) {
    return Response.json(
      { error: resolved.reason },
      { status: REFUSAL_STATUS[resolved.reason], headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_photo" },
      { status: 422, headers: NO_STORE },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(parsed.data.data, "base64"));
  } catch {
    return Response.json(
      { error: "invalid_photo" },
      { status: 422, headers: NO_STORE },
    );
  }

  try {
    const result = await storeDispatchPhoto(
      resolved.job,
      parsed.data.clientActionId,
      parsed.data.mimeType,
      bytes,
    );

    if (!result.ok) {
      // 413 is retryable-looking but is not: the client must shrink it first,
      // and the queue drops any non-429 4xx rather than retrying forever.
      return Response.json(
        { error: result.reason },
        {
          status: result.reason === "too_large" ? 413 : 422,
          headers: NO_STORE,
        },
      );
    }

    return Response.json(
      { ok: true, outcome: result.outcome },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[dispatch] photo upload failed", {
      dispatchId: resolved.job.dispatchId,
      // Never the body: it is attacker-controlled bytes.
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "upload_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

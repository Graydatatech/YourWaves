import "server-only";

import { sql } from "@/db/client";
import { asUser, type AdminSession } from "./session";

/**
 * The admin's view of dispatch: who was told about a job, whether they looked,
 * and what they did.
 *
 * Reads go through `asUser` so the RLS policies apply, exactly like the rest of
 * the back office. Writes call the SQL functions, which own token minting and
 * the transactional link between a dispatch row and its WhatsApp message.
 */

export type DispatchRow = {
  id: string;
  recipientId: string | null;
  fullName: string;
  phone: string;
  locale: string;
  sentAt: string | null;
  openedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  isExpired: boolean;
  /** What this person has done from their link. */
  actions: Array<{ action: string; outcome: string; createdAt: string }>;
  opens: number;
};

export async function dispatchesForBooking(
  session: AdminSession,
  bookingId: string,
): Promise<DispatchRow[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        recipient_id: string | null;
        full_name: string;
        phone: string;
        locale: string;
        sent_at: string | null;
        opened_at: string | null;
        revoked_at: string | null;
        token_expires_at: string;
        opens: number;
      }[]
    >`
      SELECT d.id, d.recipient_id, d.full_name, d.phone, d.locale,
             d.sent_at, d.opened_at, d.revoked_at, d.token_expires_at,
             (SELECT count(*)::int FROM dispatch_access_log l
               WHERE l.dispatch_id = d.id AND l.outcome = 'opened') AS opens
        FROM booking_dispatch d
       WHERE d.booking_id = ${bookingId}::uuid
       ORDER BY d.created_at
    `;

    if (rows.length === 0) return [];

    const actions = await tx<
      {
        dispatch_id: string;
        action: string;
        outcome: string;
        created_at: string;
      }[]
    >`
      SELECT dispatch_id, action, outcome, created_at
        FROM booking_dispatch_actions
       WHERE dispatch_id = ANY(${rows.map((row) => row.id)}::uuid[])
       ORDER BY created_at
    `;

    return rows.map((row) => ({
      id: row.id,
      recipientId: row.recipient_id,
      fullName: row.full_name,
      phone: row.phone,
      locale: row.locale,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
      openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      expiresAt: new Date(row.token_expires_at).toISOString(),
      isExpired: new Date(row.token_expires_at).getTime() <= Date.now(),
      opens: row.opens,
      actions: actions
        .filter((action) => action.dispatch_id === row.id)
        .map((action) => ({
          action: action.action,
          outcome: action.outcome,
          createdAt: new Date(action.created_at).toISOString(),
        })),
    }));
  });
}

export type RecipientRow = {
  id: string;
  fullName: string;
  phone: string;
  role: string;
  isDefault: boolean;
  isActive: boolean;
};

export async function listRecipients(
  session: AdminSession,
): Promise<RecipientRow[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        full_name: string;
        phone: string;
        role: string;
        is_default: boolean;
        is_active: boolean;
      }[]
    >`
      SELECT id, full_name, phone, role, is_default, is_active
        FROM dispatch_recipients
       ORDER BY is_active DESC, is_default DESC, full_name
    `;
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      role: row.role,
      isDefault: row.is_default,
      isActive: row.is_active,
    }));
  });
}

export type DispatchOutcome =
  | "DISPATCHED"
  | "REDISPATCHED"
  | "ALREADY_DISPATCHED"
  | "BOOKING_NOT_FOUND"
  | "NO_PHONE";

/**
 * Adds a recipient to one booking, minting them their own link.
 *
 * `rotate` is what "resend to someone who lost the message" means: a NEW token,
 * so the old link — which may be sitting in a forwarded WhatsApp thread — stops
 * working. Resending the same token would be a resend in name only.
 */
export async function dispatchToPhone(
  session: AdminSession,
  bookingId: string,
  input: {
    phone: string;
    fullName: string;
    /** Where the job sheet goes. Null falls back to WhatsApp — see 0020. */
    email?: string | null;
    recipientId?: string | null;
    locale?: string;
    rotate?: boolean;
  },
): Promise<{ outcome: DispatchOutcome; dispatchId: string | null }> {
  const rows = await sql<
    { dispatch_id: string | null; outcome: DispatchOutcome }[]
  >`
    SELECT * FROM create_booking_dispatch(
      ${bookingId}::uuid, ${input.phone}, ${input.fullName},
      ${input.recipientId ?? null}::uuid, ${input.locale ?? "en"},
      ${input.rotate ?? false}, ${input.email ?? null}
    )
  `;
  return { outcome: rows[0].outcome, dispatchId: rows[0].dispatch_id };
}

export type DispatchPhotoRow = {
  id: string;
  dispatchId: string;
  byteSize: number;
  createdAt: string;
};

/**
 * The completion photos for one booking — metadata only.
 *
 * The bytes are fetched one at a time by /api/admin/photos/[id], so listing a
 * booking with four photos does not drag a megabyte through the page payload
 * on an ops person's phone.
 */
export async function photosForBooking(
  session: AdminSession,
  bookingId: string,
): Promise<DispatchPhotoRow[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        dispatch_id: string;
        byte_size: number;
        created_at: string;
      }[]
    >`
      SELECT id, dispatch_id, byte_size, created_at
        FROM booking_dispatch_photos
       WHERE booking_id = ${bookingId}::uuid
       ORDER BY created_at
    `;
    return rows.map((row) => ({
      id: row.id,
      dispatchId: row.dispatch_id,
      byteSize: row.byte_size,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  });
}

/** One photo's bytes, for the admin image route. */
export async function readDispatchPhoto(
  session: AdminSession,
  photoId: string,
): Promise<{ mimeType: string; image: Buffer } | null> {
  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ mime_type: string; image: Buffer }[]>`
      SELECT mime_type, image FROM booking_dispatch_photos
       WHERE id = ${photoId}::uuid
    `;
  });
  const row = rows[0];
  return row ? { mimeType: row.mime_type, image: row.image } : null;
}

/** Kills one link without touching anyone else's on the same booking. */
export async function revokeDispatch(
  session: AdminSession,
  dispatchId: string,
): Promise<{ ok: boolean }> {
  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      UPDATE booking_dispatch SET revoked_at = now()
       WHERE id = ${dispatchId}::uuid AND revoked_at IS NULL
      RETURNING id
    `;
  });
  return { ok: rows.length > 0 };
}

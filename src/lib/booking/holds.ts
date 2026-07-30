import "server-only";

import { sql } from "@/db/client";
import type { BookingDraft } from "./schema";

/**
 * Hold use-cases. Thin wrappers over the SQL functions — deliberately thin,
 * because every decision that matters (locking, availability, atomicity) lives
 * in drizzle/0005_booking_holds.sql where it can be transactional.
 */

/** Machine-readable reasons a hold can be refused. */
export type HoldErrorCode =
  | "DATE_TAKEN"
  | "DATE_BLACKOUT"
  | "DATE_PAST"
  | "DATE_TOO_SOON"
  | "DATE_OUT_OF_RANGE"
  | "INVALID_START_TIME"
  | "SETTINGS_MISSING";

export type HoldSuccess = {
  ok: true;
  bookingId: string;
  reference: string;
  holdExpiresAt: string;
  priceTotal: number;
  currency: string;
};

export type HoldFailure = { ok: false; code: HoldErrorCode };

type HoldRow = {
  error_code: HoldErrorCode | null;
  booking_id: string | null;
  reference: string | null;
  /**
   * A `Date` for a plain column, but a STRING when it arrives from a
   * RETURNS TABLE function — postgres.js does not apply its timestamptz parser
   * to those. Typed as the union so `toIso()` has to be used.
   */
  hold_expires_at: Date | string | null;
  price_total: number | null;
  currency: string | null;
};

/**
 * Normalises a timestamp from either driver representation to ISO 8601.
 *
 * Calling `.toISOString()` directly is what broke the first live hold with a
 * 500: the row inserted, then the response mapping threw. The direct-SQL tests
 * could not catch it because they never went through this layer.
 */
function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/**
 * Claims the date. One round trip: the function takes the per-date advisory
 * lock, re-checks availability under it, inserts, and writes the audit row, all
 * in a single transaction.
 */
export async function createHold(
  draft: BookingDraft & { customerPhone: string },
): Promise<HoldSuccess | HoldFailure> {
  const rows = await sql<HoldRow[]>`
    SELECT * FROM create_booking_hold(
      ${draft.bookingDate}::date,
      ${draft.preferredStart}::time,
      ${draft.customerName},
      ${draft.customerPhone},
      ${draft.addressLine},
      ${draft.customerEmail ?? null},
      ${draft.area ?? null},
      ${draft.city ?? null},
      ${draft.mapsUrl ?? null},
      ${draft.lat ?? null},
      ${draft.lng ?? null},
      ${draft.notes ?? null},
      ${draft.locale}
    )
  `;

  const row = rows[0];
  if (!row || row.error_code) {
    return {
      ok: false,
      code: (row?.error_code ?? "DATE_TAKEN") as HoldErrorCode,
    };
  }

  return {
    ok: true,
    bookingId: row.booking_id!,
    reference: row.reference!,
    holdExpiresAt: toIso(row.hold_expires_at)!,
    priceTotal: row.price_total!,
    currency: row.currency!,
  };
}

export type ReleaseErrorCode = "NOT_FOUND" | "FORBIDDEN" | "NOT_HOLDING";

export async function releaseHold(
  bookingId: string,
  phone: string,
): Promise<{ ok: true } | { ok: false; code: ReleaseErrorCode }> {
  const rows = await sql<{ error_code: ReleaseErrorCode | null }[]>`
    SELECT * FROM release_booking_hold(${bookingId}::uuid, ${phone})
  `;
  const code = rows[0]?.error_code ?? null;
  return code ? { ok: false, code } : { ok: true };
}

export type HoldSnapshot = {
  bookingId: string;
  reference: string;
  status: string;
  holdExpiresAt: string | null;
  bookingDate: string;
  preferredStart: string;
  priceTotal: number;
  currency: string;
};

/**
 * Reads a hold back, for the countdown to resynchronise after a reload or a
 * language switch. Scoped by phone so a booking id alone reveals nothing.
 */
export async function getHold(
  bookingId: string,
  phone: string,
): Promise<HoldSnapshot | null> {
  const rows = await sql<
    {
      id: string;
      reference: string;
      status: string;
      hold_expires_at: Date | string | null;
      booking_date: string;
      preferred_start: string;
      price_total: number;
      currency: string;
    }[]
  >`
    SELECT id, reference, status, hold_expires_at,
           to_char(booking_date, 'YYYY-MM-DD') AS booking_date,
           preferred_start::text AS preferred_start,
           price_total, currency
      FROM bookings
     WHERE id = ${bookingId}::uuid AND customer_phone = ${phone}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    bookingId: row.id,
    reference: row.reference,
    status: row.status,
    holdExpiresAt: toIso(row.hold_expires_at),
    bookingDate: row.booking_date,
    preferredStart: row.preferred_start,
    priceTotal: row.price_total,
    currency: row.currency,
  };
}

/** Runs the sweep. Returns how many holds were released. */
export async function sweepExpiredHolds(): Promise<number> {
  const rows = await sql<{ expire_stale_holds: number }[]>`
    SELECT expire_stale_holds()
  `;
  return rows[0]?.expire_stale_holds ?? 0;
}

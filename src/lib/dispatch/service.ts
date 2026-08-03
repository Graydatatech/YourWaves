import "server-only";

import { sql } from "@/db/client";
import { hashDispatchToken, looksLikeDispatchToken } from "./token";
import type { IsoDate } from "@/lib/dates";

/**
 * Resolving a dispatch link, and everything that has to be true before it
 * returns a customer's address.
 *
 * There is no session here — the token is the whole authorisation — so the
 * refusals matter more than the success path, and all of them look identical
 * from outside. A stranger poking at /d/ must not be able to tell "no such
 * token" from "expired" from "revoked", because that difference is a signal
 * about which tokens exist.
 */

export type DispatchRefusal =
  | "malformed"
  | "not_found"
  | "expired"
  | "revoked"
  | "rate_limited";

export type DispatchJob = {
  dispatchId: string;
  bookingId: string;
  reference: string;
  recipientName: string;
  recipientPhone: string;
  locale: "ar" | "en";

  status: string;
  bookingDate: IsoDate;
  preferredStart: string;
  /** 90 minutes before the customer's slot — what the crew is held to. */
  arrivalTime: string;

  customerName: string;
  customerPhone: string;
  addressLine: string;
  area: string | null;
  city: string | null;
  mapsUrl: string | null;
  lat: string | null;
  lng: string | null;
  notes: string | null;

  priceTotal: number;
  currency: string;
  isPaid: boolean;

  driverName: string | null;
  expiresAt: string;
};

export type DispatchResult =
  | { ok: true; job: DispatchJob }
  | { ok: false; reason: DispatchRefusal };

type AccessContext = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Rate limits, counted from the access log so there is one source of truth for
 * "who has been hitting this".
 *
 * Two dimensions, because they catch different things: per-IP stops someone
 * enumerating tokens from one machine, per-token stops a leaked link being
 * hammered from many.
 */
const IP_LIMIT = 60;
const TOKEN_LIMIT = 120;
const WINDOW = "1 minute";

async function isRateLimited(
  ip: string | null,
  tokenHash: string,
): Promise<boolean> {
  const rows = await sql<{ ip_hits: number; token_hits: number }[]>`
    SELECT
      count(*) FILTER (
        WHERE ${ip}::inet IS NOT NULL AND ip = ${ip}::inet
      )::int AS ip_hits,
      count(*) FILTER (WHERE token_hash = ${tokenHash})::int AS token_hits
      FROM dispatch_access_log
     WHERE created_at > now() - ${WINDOW}::interval
  `;

  const row = rows[0];
  return row.ip_hits >= IP_LIMIT || row.token_hits >= TOKEN_LIMIT;
}

async function logAccess(
  dispatchId: string | null,
  tokenHash: string | null,
  outcome: string,
  context: AccessContext,
): Promise<void> {
  await sql`
    INSERT INTO dispatch_access_log (dispatch_id, token_hash, ip, user_agent, outcome)
    VALUES (
      ${dispatchId}::uuid, ${tokenHash},
      ${context.ip}::inet,
      ${context.userAgent?.slice(0, 400) ?? null},
      ${outcome}
    )
  `;
}

/**
 * Turns a raw token into a job, or a refusal.
 *
 * `markOpened` is false for the status endpoint: opening the page is what
 * counts as "the recipient looked", and a background POST should not rewrite
 * that timestamp.
 */
export async function resolveDispatchToken(
  token: string,
  context: AccessContext,
  options?: { markOpened?: boolean },
): Promise<DispatchResult> {
  // Shape first: a scanner throwing junk costs a regex, not a query.
  if (!looksLikeDispatchToken(token)) {
    await logAccess(null, null, "malformed", context);
    return { ok: false, reason: "malformed" };
  }

  const tokenHash = hashDispatchToken(token);

  if (await isRateLimited(context.ip, tokenHash)) {
    await logAccess(null, tokenHash, "rate_limited", context);
    return { ok: false, reason: "rate_limited" };
  }

  const rows = await sql<
    {
      dispatch_id: string;
      booking_id: string;
      full_name: string;
      phone: string;
      locale: string;
      token_expires_at: string;
      revoked_at: string | null;
      reference: string;
      status: string;
      booking_date: string;
      preferred_start: string;
      customer_name: string;
      customer_phone: string;
      address_line: string;
      area: string | null;
      city: string | null;
      maps_url: string | null;
      lat: string | null;
      lng: string | null;
      notes: string | null;
      price_total: number;
      currency: string;
      is_paid: boolean;
      driver_name: string | null;
    }[]
  >`
    SELECT d.id AS dispatch_id, d.booking_id, d.full_name, d.phone, d.locale,
           d.token_expires_at, d.revoked_at,
           b.reference, b.status::text,
           to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
           to_char(b.preferred_start, 'HH24:MI:SS') AS preferred_start,
           b.customer_name, b.customer_phone, b.address_line, b.area, b.city,
           b.maps_url, b.lat::text, b.lng::text, b.notes,
           b.price_total, b.currency,
           EXISTS (
             SELECT 1 FROM payments p
              WHERE p.booking_id = b.id AND p.status = 'paid'
           ) AS is_paid,
           r.full_name AS driver_name
      FROM booking_dispatch d
      JOIN bookings b ON b.id = d.booking_id
      LEFT JOIN dispatch_recipients r ON r.id = b.assigned_driver
     WHERE d.token_hash = ${tokenHash}
  `;

  const row = rows[0];

  if (!row) {
    await logAccess(null, tokenHash, "not_found", context);
    return { ok: false, reason: "not_found" };
  }

  if (row.revoked_at) {
    await logAccess(row.dispatch_id, tokenHash, "revoked", context);
    return { ok: false, reason: "revoked" };
  }

  if (new Date(row.token_expires_at).getTime() <= Date.now()) {
    await logAccess(row.dispatch_id, tokenHash, "expired", context);
    return { ok: false, reason: "expired" };
  }

  await logAccess(row.dispatch_id, tokenHash, "opened", context);

  if (options?.markOpened !== false) {
    // First open only: this is "when did they look", not "when did they last
    // refresh".
    await sql`
      UPDATE booking_dispatch SET opened_at = COALESCE(opened_at, now())
       WHERE id = ${row.dispatch_id}::uuid
    `;
  }

  return {
    ok: true,
    job: {
      dispatchId: row.dispatch_id,
      bookingId: row.booking_id,
      reference: row.reference,
      recipientName: row.full_name,
      recipientPhone: row.phone,
      locale: row.locale === "ar" ? "ar" : "en",
      status: row.status,
      bookingDate: row.booking_date,
      preferredStart: row.preferred_start,
      arrivalTime: arrivalClock(row.preferred_start),
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      addressLine: row.address_line,
      area: row.area,
      city: row.city,
      mapsUrl: row.maps_url,
      lat: row.lat,
      lng: row.lng,
      notes: row.notes,
      priceTotal: row.price_total,
      currency: row.currency,
      isPaid: row.is_paid,
      driverName: row.driver_name,
      expiresAt: new Date(row.token_expires_at).toISOString(),
    },
  };
}

/**
 * How long before the customer's slot the crew is on site, on the clock face.
 *
 * Must match CREW_LEAD_MINUTES in templates/context.ts: the job sheet and the
 * assignment message would otherwise give the same driver two arrival times.
 */
export const CREW_LEAD_MINUTES = 180;

export function arrivalClock(start: string): string {
  const [hour, minute] = start.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return start;
  // Plain minute arithmetic, not a Date: this is a wall-clock time in Qatar
  // with no date attached, and routing it through a Date is how §4b's timezone
  // bug comes back.
  const total = Math.max(hour * 60 + minute - CREW_LEAD_MINUTES, 0);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}:00`;
}

/**
 * The client's IP, as far as it can be trusted.
 *
 * Behind Vercel or any reverse proxy, the socket address is the proxy, so
 * `x-forwarded-for` is what identifies the caller — and only its FIRST entry,
 * because anything after it was supplied by the client and is not evidence.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

import "server-only";

import { sql } from "./client";
import type { IsoDate } from "@/lib/dates";
import type { ServiceArea } from "@/lib/booking/serviceArea";

/**
 * Read paths used by the public API routes.
 *
 * Kept deliberately narrow: these are the only queries a customer request can
 * reach, and each returns the minimum the caller needs. Customers are
 * anonymous and never touch the database directly (see drizzle/0002_rls.sql) —
 * everything goes through here, server-side.
 */

export type SettingsRow = {
  price_rental: number;
  price_setup: number;
  price_delivery: number;
  currency: string;
  available_start_times: string[];
  lead_time_hours: number;
  max_advance_days: number;
  hold_minutes: number;
  admin_notification_emails: string[];
  /** jsonb [{en, ar}] since migration 0012 — see @/lib/booking/serviceArea. */
  service_areas: ServiceArea[];
};

export async function getSettings(): Promise<SettingsRow> {
  const rows = await sql<SettingsRow[]>`
    SELECT price_rental, price_setup, price_delivery, currency,
           available_start_times, lead_time_hours, max_advance_days,
           hold_minutes, admin_notification_emails, service_areas
      FROM settings
     WHERE id = 1
  `;
  const settings = rows[0];
  if (!settings) {
    throw new Error("settings row is missing — run `pnpm db:seed`");
  }
  return settings;
}

/**
 * Days occupied by a booking, within an inclusive date range.
 *
 * Reads the `active_bookings` view rather than the table, so the definition of
 * "occupied" lives in exactly one place (drizzle/0001_booking_locking.sql) and
 * matches the partial unique index. The view also excludes holds whose lock has
 * lapsed but which have not yet been swept, so a date frees up the moment the
 * hold expires rather than when a cleanup job happens to run.
 *
 * `::date` casts keep the comparison in the date domain — no timestamp, so no
 * timezone can shift the boundary days.
 */
export async function getBookedDates(
  from: IsoDate,
  to: IsoDate,
): Promise<Set<IsoDate>> {
  const rows = await sql<{ booking_date: string }[]>`
    SELECT to_char(booking_date, 'YYYY-MM-DD') AS booking_date
      FROM active_bookings
     WHERE booking_date BETWEEN ${from}::date AND ${to}::date
  `;
  return new Set(rows.map((row) => row.booking_date));
}

export async function getBlackoutDates(
  from: IsoDate,
  to: IsoDate,
): Promise<Set<IsoDate>> {
  const rows = await sql<{ date: string }[]>`
    SELECT to_char(date, 'YYYY-MM-DD') AS date
      FROM blackout_dates
     WHERE date BETWEEN ${from}::date AND ${to}::date
  `;
  return new Set(rows.map((row) => row.date));
}

import "server-only";

import { sql } from "@/db/client";
import { asUser, type AdminSession } from "./session";
import { qatarToday, type IsoDate } from "@/lib/dates";
import { toServiceAreas } from "@/lib/booking/serviceArea";
import {
  OPERATIONAL_STATUSES,
  type AdminSettings,
  type BookingNoteRow,
  type BookingStatus,
  type BookingSummary,
  type CalendarDay,
  type DriverRow,
  type OrdersResult,
} from "./types";

// The domain vocabulary lives in ./types.ts, which is NOT server-only: client
// components need the status list and the transition map, and importing them
// from here would pull the database client into the browser bundle.
export * from "./types";

/**
 * Everything the back office reads.
 *
 * Every function takes the session and runs inside `asUser`, so the RLS
 * policies from 0008 decide what comes back. A missing WHERE clause here
 * cannot leak another driver's booking — the database refuses to return it.
 *
 * Dates are `IsoDate` strings throughout, per §4b. `booking_date` is a calendar
 * day in Qatar and is never converted through a Date.
 */

type SummaryRow = {
  id: string;
  reference: string;
  booking_date: string;
  preferred_start: string;
  status: BookingStatus;
  customer_name: string;
  customer_phone: string;
  address_line: string;
  area: string | null;
  city: string | null;
  price_total: number;
  currency: string;
  driver_id: string | null;
  driver_name: string | null;
  created_at: string;
};

function toSummary(row: SummaryRow): BookingSummary {
  return {
    id: row.id,
    reference: row.reference,
    bookingDate: row.booking_date,
    preferredStart: row.preferred_start,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    addressLine: row.address_line,
    area: row.area,
    city: row.city,
    priceTotal: row.price_total,
    currency: row.currency,
    driverId: row.driver_id,
    driverName: row.driver_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * The projection every list screen shares.
 *
 * A FUNCTION, not a module-level constant. Building the fragment eagerly means
 * calling `sql` while this module is being imported — and `next build` imports
 * every route module to collect page data, so it ran at build time and demanded
 * DATABASE_URL from an environment that has no reason to have one. That failed
 * the Vercel deployment. Deferring it to call time costs nothing: postgres.js
 * rebuilds the fragment per query anyway.
 */
function summaryColumns() {
  return sql`
    b.id, b.reference,
    to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
    to_char(b.preferred_start, 'HH24:MI:SS') AS preferred_start,
    b.status, b.customer_name, b.customer_phone, b.address_line,
    b.area, b.city, b.price_total, b.currency, b.created_at,
    d.id AS driver_id, d.full_name AS driver_name
  `;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type OverviewData = {
  today: IsoDate;
  todaysBooking: BookingSummary | null;
  /** Next upcoming job when there is nothing on today — an empty screen is useless. */
  nextBooking: BookingSummary | null;
  counts: Record<BookingStatus, number>;
  weekRevenue: { total: number; currency: string; bookings: number };
  needsDriver: BookingSummary[];
  activeDrivers: number;
};

export async function getOverview(
  session: AdminSession,
  now = new Date(),
): Promise<OverviewData> {
  const today = qatarToday(now);

  return asUser(session.userId, async (tx) => {
    const todaysRows = await tx<SummaryRow[]>`
      SELECT ${summaryColumns()}
        FROM bookings b
        LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
       WHERE b.booking_date = ${today}::date
         AND b.status IN ('confirmed','assigned','en_route','completed')
       ORDER BY b.preferred_start
       LIMIT 1
    `;

    const nextRows = todaysRows.length
      ? []
      : await tx<SummaryRow[]>`
          SELECT ${summaryColumns()}
            FROM bookings b
            LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
           WHERE b.booking_date > ${today}::date
             AND b.status IN ('confirmed','assigned','en_route')
           ORDER BY b.booking_date, b.preferred_start
           LIMIT 1
        `;

    const countRows = await tx<{ status: BookingStatus; count: number }[]>`
      SELECT status::text AS status, count(*)::int AS count
        FROM bookings
       WHERE booking_date >= ${today}::date - 30
       GROUP BY status
    `;

    const counts = Object.fromEntries(
      OPERATIONAL_STATUSES.map((status) => [status, 0]),
    ) as Record<BookingStatus, number>;
    for (const row of countRows) counts[row.status] = row.count;

    // The operating week is Sunday-Saturday in Qatar. Computed in SQL with
    // date arithmetic so it stays a calendar week and never crosses a timezone.
    const revenueRows = await tx<
      { total: string | null; currency: string | null; bookings: number }[]
    >`
      SELECT sum(price_total)::text AS total,
             max(currency) AS currency,
             count(*)::int AS bookings
        FROM bookings
       WHERE booking_date >= date_trunc('week', ${today}::date + 1)::date - 1
         AND booking_date <  date_trunc('week', ${today}::date + 1)::date + 6
         AND status IN ('confirmed','assigned','en_route','completed')
    `;

    const needsDriver = await tx<SummaryRow[]>`
      SELECT ${summaryColumns()}
        FROM bookings b
        LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
       WHERE b.status = 'confirmed'
         AND b.assigned_driver IS NULL
         AND b.booking_date >= ${today}::date
       ORDER BY b.booking_date, b.preferred_start
       LIMIT 20
    `;

    const [{ count: activeDrivers }] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM dispatch_recipients WHERE is_active
    `;

    return {
      today,
      todaysBooking: todaysRows[0] ? toSummary(todaysRows[0]) : null,
      nextBooking: nextRows[0] ? toSummary(nextRows[0]) : null,
      counts,
      weekRevenue: {
        total: Number(revenueRows[0]?.total ?? 0),
        currency: revenueRows[0]?.currency ?? "QAR",
        bookings: revenueRows[0]?.bookings ?? 0,
      },
      needsDriver: needsDriver.map(toSummary),
      activeDrivers,
    };
  });
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function getCalendarMonth(
  session: AdminSession,
  month: string,
): Promise<CalendarDay[]> {
  return asUser(session.userId, async (tx) => {
    const bookings = await tx<SummaryRow[]>`
      SELECT ${summaryColumns()}
        FROM bookings b
        LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
       WHERE to_char(b.booking_date, 'YYYY-MM') = ${month}
         AND b.status <> 'expired'
       ORDER BY b.booking_date, b.preferred_start
    `;

    const blackouts = await tx<
      { id: string; date: string; reason: string | null }[]
    >`
      SELECT id, to_char(date, 'YYYY-MM-DD') AS date, reason
        FROM blackout_dates
       WHERE to_char(date, 'YYYY-MM') = ${month}
    `;

    const byDate = new Map<string, CalendarDay>();
    const dayFor = (date: string) => {
      let day = byDate.get(date);
      if (!day) {
        day = { date, bookings: [], blackout: null };
        byDate.set(date, day);
      }
      return day;
    };

    for (const row of bookings)
      dayFor(row.booking_date).bookings.push(toSummary(row));
    for (const row of blackouts) {
      dayFor(row.date).blackout = { id: row.id, reason: row.reason };
    }

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderFilters = {
  search?: string;
  status?: BookingStatus | "all";
  driverId?: string | "all" | "unassigned";
  city?: string | "all";
  from?: IsoDate;
  to?: IsoDate;
  sort?: "date" | "created" | "amount" | "reference";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORT_COLUMNS = {
  date: "b.booking_date",
  created: "b.created_at",
  amount: "b.price_total",
  reference: "b.reference",
} as const;

/**
 * The orders query, shared by the table and the CSV export.
 *
 * `limit: null` returns everything, which is what the export wants — an export
 * that silently gave you page one would be worse than no export.
 */
export async function getOrders(
  session: AdminSession,
  filters: OrderFilters,
  options?: { unpaginated?: boolean },
): Promise<OrdersResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 200);
  const sortKey = SORT_COLUMNS[filters.sort ?? "date"];
  const direction = filters.direction === "asc" ? "ASC" : "DESC";

  // Every value is parameterised; only the sort column and direction are
  // interpolated, and both come from a closed allow-list above.
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const status =
    filters.status && filters.status !== "all" ? filters.status : null;
  const city = filters.city && filters.city !== "all" ? filters.city : null;
  const driverFilter = filters.driverId ?? "all";

  return asUser(session.userId, async (tx) => {
    const where = tx`
      WHERE (${status}::text IS NULL OR b.status::text = ${status})
        AND (${city}::text IS NULL OR b.city = ${city})
        AND (${filters.from ?? null}::date IS NULL OR b.booking_date >= ${filters.from ?? null}::date)
        AND (${filters.to ?? null}::date IS NULL OR b.booking_date <= ${filters.to ?? null}::date)
        AND (
          ${driverFilter} = 'all'
          OR (${driverFilter} = 'unassigned' AND b.assigned_driver IS NULL)
          OR (b.assigned_driver::text = ${driverFilter})
        )
        AND (
          ${search}::text IS NULL
          OR b.customer_name ILIKE ${search}
          OR b.customer_phone ILIKE ${search}
          OR b.reference ILIKE ${search}
          OR b.customer_email ILIKE ${search}
        )
    `;

    const [{ count: total }] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM bookings b ${where}
    `;

    const rows = options?.unpaginated
      ? await tx<SummaryRow[]>`
          SELECT ${summaryColumns()}
            FROM bookings b
            LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
            ${where}
           ORDER BY ${tx.unsafe(sortKey)} ${tx.unsafe(direction)}, b.reference DESC
        `
      : await tx<SummaryRow[]>`
          SELECT ${summaryColumns()}
            FROM bookings b
            LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
            ${where}
           ORDER BY ${tx.unsafe(sortKey)} ${tx.unsafe(direction)}, b.reference DESC
           LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;

    return {
      rows: rows.map(toSummary),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  });
}

/** Distinct cities present in the data, for the filter dropdown. */
export async function getCities(session: AdminSession): Promise<string[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<{ city: string }[]>`
      SELECT DISTINCT city FROM bookings
       WHERE city IS NOT NULL AND btrim(city) <> ''
       ORDER BY city
    `;
    return rows.map((row) => row.city);
  });
}

// ---------------------------------------------------------------------------
// Booking detail
// ---------------------------------------------------------------------------

export type BookingDetail = BookingSummary & {
  customerEmail: string | null;
  mapsUrl: string | null;
  lat: string | null;
  lng: string | null;
  notes: string | null;
  locale: string;
  priceRental: number;
  priceSetup: number;
  priceDelivery: number;
  holdExpiresAt: string | null;
  phoneVerifiedAt: string | null;
  updatedAt: string;
};

export type PaymentRow = {
  id: string;
  provider: string;
  providerRef: string | null;
  amount: number;
  currency: string;
  status: string;
  refundRequired: boolean;
  refundReason: string | null;
  createdAt: string;
};

export type BookingEventRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BookingDetailBundle = {
  booking: BookingDetail;
  payments: PaymentRow[];
  events: BookingEventRow[];
  notes: BookingNoteRow[];
};

export async function getBookingDetail(
  session: AdminSession,
  reference: string,
): Promise<BookingDetailBundle | null> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      (SummaryRow & {
        customer_email: string | null;
        maps_url: string | null;
        lat: string | null;
        lng: string | null;
        notes: string | null;
        locale: string;
        price_rental: number;
        price_setup: number;
        price_delivery: number;
        hold_expires_at: string | null;
        phone_verified_at: string | null;
        updated_at: string;
      })[]
    >`
      SELECT ${summaryColumns()},
             b.customer_email, b.maps_url, b.lat::text, b.lng::text, b.notes,
             b.locale, b.price_rental, b.price_setup, b.price_delivery,
             b.hold_expires_at, b.phone_verified_at, b.updated_at
        FROM bookings b
        LEFT JOIN dispatch_recipients d ON d.id = b.assigned_driver
       WHERE b.reference = ${reference}
    `;

    const row = rows[0];
    if (!row) return null;

    const payments = await tx<
      {
        id: string;
        provider: string;
        provider_ref: string | null;
        amount: number;
        currency: string;
        status: string;
        refund_required: boolean;
        refund_reason: string | null;
        created_at: string;
      }[]
    >`
      SELECT id, provider, provider_ref, amount, currency, status::text,
             refund_required, refund_reason, created_at
        FROM payments WHERE booking_id = ${row.id}::uuid
       ORDER BY created_at DESC
    `;

    const events = await tx<
      {
        id: string;
        from_status: string | null;
        to_status: string;
        actor_type: string;
        actor_id: string | null;
        metadata: Record<string, unknown>;
        created_at: string;
      }[]
    >`
      SELECT id, from_status::text, to_status::text, actor_type::text,
             actor_id, metadata, created_at
        FROM booking_events WHERE booking_id = ${row.id}::uuid
       ORDER BY created_at DESC, id DESC
    `;

    const notes = await tx<
      { id: string; author_name: string; body: string; created_at: string }[]
    >`
      SELECT id, author_name, body, created_at
        FROM booking_notes WHERE booking_id = ${row.id}::uuid
       ORDER BY created_at DESC
    `;

    return {
      booking: {
        ...toSummary(row),
        customerEmail: row.customer_email,
        mapsUrl: row.maps_url,
        lat: row.lat,
        lng: row.lng,
        notes: row.notes,
        locale: row.locale,
        priceRental: row.price_rental,
        priceSetup: row.price_setup,
        priceDelivery: row.price_delivery,
        holdExpiresAt: row.hold_expires_at
          ? new Date(row.hold_expires_at).toISOString()
          : null,
        phoneVerifiedAt: row.phone_verified_at
          ? new Date(row.phone_verified_at).toISOString()
          : null,
        updatedAt: new Date(row.updated_at).toISOString(),
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        providerRef: payment.provider_ref,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        refundRequired: payment.refund_required,
        refundReason: payment.refund_reason,
        createdAt: new Date(payment.created_at).toISOString(),
      })),
      events: events.map((event) => ({
        id: event.id,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actorType: event.actor_type,
        actorId: event.actor_id,
        metadata: event.metadata ?? {},
        createdAt: new Date(event.created_at).toISOString(),
      })),
      notes: notes.map((note) => ({
        id: note.id,
        authorName: note.author_name,
        body: note.body,
        createdAt: new Date(note.created_at).toISOString(),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Drivers and settings
// ---------------------------------------------------------------------------

export async function getDrivers(session: AdminSession): Promise<DriverRow[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        full_name: string;
        phone: string;
        role: DriverRow["role"];
        is_default: boolean;
        is_active: boolean;
        active_jobs: number;
        total_jobs: number;
      }[]
    >`
      SELECT d.id, d.full_name, d.phone, d.role, d.is_default, d.is_active,
             (SELECT count(*)::int FROM bookings b
               WHERE b.assigned_driver = d.id
                 AND b.status IN ('assigned','en_route')) AS active_jobs,
             (SELECT count(*)::int FROM bookings b
               WHERE b.assigned_driver = d.id) AS total_jobs
        FROM dispatch_recipients d
       ORDER BY d.is_active DESC, d.is_default DESC, d.full_name
    `;
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      role: row.role,
      isDefault: row.is_default,
      isActive: row.is_active,
      activeJobs: row.active_jobs,
      totalJobs: row.total_jobs,
    }));
  });
}

export async function getAdminSettings(
  session: AdminSession,
): Promise<AdminSettings> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        price_rental: number;
        price_setup: number;
        price_delivery: number;
        currency: string;
        available_start_times: string[];
        lead_time_hours: number;
        max_advance_days: number;
        hold_minutes: number;
        admin_notification_emails: string[];
        service_areas: unknown;
        updated_at: string;
      }[]
    >`SELECT * FROM settings WHERE id = 1`;

    const row = rows[0];
    return {
      priceRental: row.price_rental,
      priceSetup: row.price_setup,
      priceDelivery: row.price_delivery,
      currency: row.currency,
      availableStartTimes: row.available_start_times,
      leadTimeHours: row.lead_time_hours,
      maxAdvanceDays: row.max_advance_days,
      holdMinutes: row.hold_minutes,
      adminNotificationEmails: row.admin_notification_emails,
      // Tolerates the pre-0012 text[] shape, so a database mid-migration
      // renders an editable list rather than throwing on the settings screen.
      serviceAreas: toServiceAreas(row.service_areas),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

export type SettingsAuditRow = {
  id: string;
  actorName: string | null;
  changedKeys: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
};

export async function getSettingsAudit(
  session: AdminSession,
  limit = 20,
): Promise<SettingsAuditRow[]> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        actor_name: string | null;
        changed_keys: string[];
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        created_at: string;
      }[]
    >`
      SELECT id, actor_name, changed_keys, before, after, created_at
        FROM settings_audit ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      changedKeys: row.changed_keys,
      before: row.before,
      after: row.after,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  });
}

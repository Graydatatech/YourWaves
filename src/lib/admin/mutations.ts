import "server-only";

import { sql } from "@/db/client";
import { asUser, type AdminSession } from "./session";
import {
  ADMIN_TRANSITIONS,
  ALLOWED_TRANSITIONS,
  type BookingStatus,
} from "./types";

export { ADMIN_TRANSITIONS, ALLOWED_TRANSITIONS } from "./types";
import type { IsoDate } from "@/lib/dates";
import type { ServiceArea } from "@/lib/booking/serviceArea";

/**
 * Everything the back office writes.
 *
 * WHERE THE AUTHORISATION BOUNDARY SITS, and why it differs from reads:
 *
 * Reads run under RLS (`asUser`), because the risk there is a missing WHERE
 * clause leaking somebody else's data, and a policy catches that no matter
 * what the query says.
 *
 * Writes go through the SQL functions — `transition_booking_status`,
 * `assign_driver`, `add_blackout_date` — which encapsulate invariants the
 * back office must not be able to skip: the legal state machine, dispatch
 * atomicity, "never black out a live booking". Those functions have EXECUTE
 * revoked from PUBLIC by design, so they run on the owner connection.
 *
 * That would be a hole if the route were the only check, so every
 * booking-scoped mutation FIRST re-reads the booking under RLS. If the caller
 * cannot see it, they cannot write it — the same guarantee, established with a
 * SELECT the database filters rather than a WHERE clause we wrote.
 */

/**
 * NOTE ON jsonb PARAMETERS, which bit this project once already.
 *
 * Always `${JSON.stringify(value)}::text::jsonb`, never `::jsonb` on its own.
 * postgres.js serialises the parameter itself when it sees a bare jsonb cast, so
 * a pre-stringified object is encoded twice and stored as a jsonb STRING —
 * `metadata->>'reason'` then returns NULL and the audit trail is unqueryable.
 * `tests/payments.test.ts` has a regression guard.
 */

/** Confirms the caller may act on this booking, under their own policies. */
async function visibleBookingId(
  session: AdminSession,
  reference: string,
): Promise<string | null> {
  return asUser(session.userId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM bookings WHERE reference = ${reference}
    `;
    return rows[0]?.id ?? null;
  });
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export type TransitionResult =
  | { ok: true; status: BookingStatus }
  | {
      ok: false;
      code: "not_found" | "illegal_transition" | "failed";
      from?: BookingStatus;
      allowed?: BookingStatus[];
    };

/**
 * Moves a booking, or refuses.
 *
 * The notification for the new status is NOT sent here. The status trigger
 * from 0007 fires it inside the same transaction, so a transition that commits
 * always has its message queued and one that rolls back never does.
 */
export async function transitionBooking(
  session: AdminSession,
  reference: string,
  to: BookingStatus,
  options?: { reason?: string },
): Promise<TransitionResult> {
  const bookingId = await visibleBookingId(session, reference);
  if (!bookingId) return { ok: false, code: "not_found" };

  const [current] = await sql<{ status: BookingStatus }[]>`
    SELECT status::text AS status FROM bookings WHERE id = ${bookingId}::uuid
  `;

  // Checked before the call so the refusal can name what IS allowed. The
  // database check below is the one that actually protects the invariant.
  if (!ALLOWED_TRANSITIONS[current.status].includes(to)) {
    return {
      ok: false,
      code: "illegal_transition",
      from: current.status,
      allowed: ADMIN_TRANSITIONS[current.status],
    };
  }

  try {
    await sql`
      SELECT transition_booking_status(
        ${bookingId}::uuid,
        ${to}::booking_status,
        'admin'::actor_type,
        ${session.email ?? session.userId},
        ${JSON.stringify({
          reason: options?.reason ?? "admin_status_change",
          actor_name: session.displayName,
        })}::text::jsonb
      )
    `;
    return { ok: true, status: to };
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 23514 is check_violation, which transition_booking_status raises for an
    // illegal move. Anything else is a genuine fault.
    if (code === "23514") {
      return {
        ok: false,
        code: "illegal_transition",
        from: current.status,
        allowed: ADMIN_TRANSITIONS[current.status],
      };
    }
    console.error("[admin] transition failed", {
      reference,
      to,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type AssignOutcome =
  | "ASSIGNED"
  | "REASSIGNED"
  | "UNCHANGED"
  | "BOOKING_NOT_FOUND"
  | "DRIVER_NOT_FOUND"
  | "DRIVER_INACTIVE"
  | "BOOKING_NOT_DISPATCHABLE";

export type AssignResult = {
  outcome: AssignOutcome;
  previousDriver: string | null;
  status: BookingStatus | null;
};

/**
 * Assigns or reassigns a driver (SRS 3.3).
 *
 * On a REASSIGNMENT the outgoing driver is told the job is no longer theirs.
 * Someone who has been told to be in Al Waab at 08:30 must hear when that stops
 * being true — silently reassigning is how two vans turn up, or none.
 */
export async function assignDriver(
  session: AdminSession,
  reference: string,
  driverId: string,
): Promise<AssignResult> {
  const bookingId = await visibleBookingId(session, reference);
  if (!bookingId) {
    return { outcome: "BOOKING_NOT_FOUND", previousDriver: null, status: null };
  }

  const rows = await sql<
    {
      outcome: AssignOutcome;
      previous_driver: string | null;
      booking_status: BookingStatus | null;
    }[]
  >`
    SELECT * FROM assign_driver(
      ${bookingId}::uuid, ${driverId}::uuid, ${session.email ?? session.userId}
    )
  `;

  const result = rows[0];

  if (result.outcome === "REASSIGNED" && result.previous_driver) {
    await notifyReplacedDriver(bookingId, result.previous_driver);
  }

  return {
    outcome: result.outcome,
    previousDriver: result.previous_driver,
    status: result.booking_status,
  };
}

/**
 * Tells the outgoing driver the job has moved.
 *
 * Uses the generic enqueue rather than a template of its own: phase 7's
 * registry has no `driver_unassigned` key, and inventing one here without
 * copy in both catalogues would render as a raw message key. This writes an
 * admin-visible record and reuses the cancellation copy, which is the closest
 * true statement — the job IS cancelled, for them.
 *
 * A dedicated template is the right fix; it needs copy and a Meta template, so
 * it is left for phase 9 when the driver portal defines its own vocabulary.
 */
async function notifyReplacedDriver(
  bookingId: string,
  previousDriverId: string,
): Promise<void> {
  try {
    await sql`
      SELECT enqueue_notification(
        ${bookingId}::uuid, 'whatsapp', 'driver',
        (SELECT phone FROM dispatch_recipients WHERE id = ${previousDriverId}::uuid),
        'booking_cancelled', 'en',
        booking_notification_payload(${bookingId}::uuid)
          || jsonb_build_object('reassigned', true)
      )
    `;
  } catch (error) {
    // Never fail a dispatch because the courtesy message could not be queued.
    console.error("[admin] could not notify replaced driver", {
      bookingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addBookingNote(
  session: AdminSession,
  reference: string,
  body: string,
): Promise<{ ok: boolean }> {
  const bookingId = await visibleBookingId(session, reference);
  if (!bookingId) return { ok: false };

  await sql`
    INSERT INTO booking_notes (booking_id, author_id, author_name, body)
    VALUES (${bookingId}::uuid, ${session.userId}::uuid,
            ${session.displayName}, ${body.trim()})
  `;
  return { ok: true };
}

export async function deleteBookingNote(
  session: AdminSession,
  noteId: string,
): Promise<{ ok: boolean }> {
  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      DELETE FROM booking_notes WHERE id = ${noteId}::uuid RETURNING id
    `;
  });
  return { ok: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Blackouts
// ---------------------------------------------------------------------------

export type BlackoutResult =
  { ok: true; id: string } | { ok: false; code: "date_has_booking" };

export async function addBlackout(
  session: AdminSession,
  date: IsoDate,
  reason: string,
): Promise<BlackoutResult> {
  const rows = await sql<{ outcome: string; blackout_id: string | null }[]>`
    SELECT * FROM add_blackout_date(
      ${date}::date, ${reason}, ${session.email ?? session.displayName}
    )
  `;

  if (rows[0].outcome === "DATE_HAS_BOOKING") {
    return { ok: false, code: "date_has_booking" };
  }
  return { ok: true, id: rows[0].blackout_id! };
}

export async function removeBlackout(
  session: AdminSession,
  date: IsoDate,
): Promise<{ ok: boolean }> {
  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      DELETE FROM blackout_dates WHERE date = ${date}::date RETURNING id
    `;
  });
  return { ok: rows.length > 0 };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsPatch = {
  priceRental?: number;
  priceSetup?: number;
  priceDelivery?: number;
  availableStartTimes?: string[];
  leadTimeHours?: number;
  maxAdvanceDays?: number;
  holdMinutes?: number;
  serviceAreas?: ServiceArea[];
  adminNotificationEmails?: string[];
};

/**
 * Columns that are jsonb rather than a scalar or a Postgres array.
 *
 * They cannot go through the generic assignment: postgres.js would encode an
 * array of objects as an array literal and the UPDATE would fail. They are
 * cast `::text::jsonb` for the reason §4h records — a pre-stringified value
 * handed straight to a `::jsonb` cast gets encoded twice and lands as a jsonb
 * STRING, after which `->>` returns NULL for every key.
 */
const JSONB_SETTINGS_COLUMNS = new Set<keyof SettingsPatch>(["serviceAreas"]);

const SETTINGS_COLUMNS: Record<keyof SettingsPatch, string> = {
  priceRental: "price_rental",
  priceSetup: "price_setup",
  priceDelivery: "price_delivery",
  availableStartTimes: "available_start_times",
  leadTimeHours: "lead_time_hours",
  maxAdvanceDays: "max_advance_days",
  holdMinutes: "hold_minutes",
  serviceAreas: "service_areas",
  adminNotificationEmails: "admin_notification_emails",
};

/**
 * Updates settings and records who changed what.
 *
 * Pricing decides what every future booking charges, so "who changed the day
 * rate, and when?" has to be answerable. The before/after pair is written in
 * the same transaction as the change, and `settings_audit` is append-only by
 * trigger.
 */
export async function updateSettings(
  session: AdminSession,
  patch: SettingsPatch,
): Promise<{ ok: true; changed: string[] }> {
  const entries = Object.entries(patch).filter(
    ([, value]) => value !== undefined,
  ) as Array<[keyof SettingsPatch, unknown]>;

  if (entries.length === 0) return { ok: true, changed: [] };

  return sql.begin(async (tx) => {
    const [before] = await tx<Record<string, unknown>[]>`
      SELECT * FROM settings WHERE id = 1 FOR UPDATE
    `;

    const assignments = entries.map(([key, value]) =>
      JSONB_SETTINGS_COLUMNS.has(key)
        ? tx`${tx.unsafe(SETTINGS_COLUMNS[key])} = ${JSON.stringify(value)}::text::jsonb`
        : tx`${tx.unsafe(SETTINGS_COLUMNS[key])} = ${value as never}`,
    );

    const [after] = await tx<Record<string, unknown>[]>`
      UPDATE settings
         SET ${assignments.reduce((acc, part, index) =>
           index === 0 ? part : tx`${acc}, ${part}`,
         )},
             updated_at = now()
       WHERE id = 1
      RETURNING *
    `;

    const changed = entries
      .map(([key]) => SETTINGS_COLUMNS[key])
      .filter(
        (column) =>
          JSON.stringify(before[column]) !== JSON.stringify(after[column]),
      );

    if (changed.length > 0) {
      await tx`
        INSERT INTO settings_audit (actor_id, actor_name, before, after, changed_keys)
        VALUES (
          ${session.userId}::uuid, ${session.displayName},
          ${JSON.stringify(before)}::text::jsonb,
          ${JSON.stringify(after)}::text::jsonb,
          ${changed}
        )
      `;
    }

    return { ok: true as const, changed };
  });
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function createDriver(
  session: AdminSession,
  input: {
    fullName: string;
    phone: string;
    role?: "driver" | "owner" | "supervisor" | "other";
    isDefault?: boolean;
  },
): Promise<{ id: string }> {
  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      INSERT INTO dispatch_recipients (full_name, phone, role, is_default)
      VALUES (${input.fullName.trim()}, ${input.phone.trim()},
              ${input.role ?? "driver"}, ${input.isDefault ?? false})
      RETURNING id
    `;
  });
  return { id: rows[0].id };
}

export async function updateDriver(
  session: AdminSession,
  driverId: string,
  patch: {
    fullName?: string;
    phone?: string;
    role?: "driver" | "owner" | "supervisor" | "other";
    isDefault?: boolean;
    isActive?: boolean;
  },
): Promise<{ ok: boolean; code?: "has_active_jobs" }> {
  // Deactivating someone who is mid-job would quietly remove them from the
  // dispatch list while a van is still on the road.
  if (patch.isActive === false) {
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM bookings
       WHERE assigned_driver = ${driverId}::uuid
         AND status IN ('assigned','en_route')
    `;
    if (count > 0) return { ok: false, code: "has_active_jobs" };
  }

  const rows = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      UPDATE dispatch_recipients SET
        full_name  = COALESCE(${patch.fullName ?? null}, full_name),
        phone      = COALESCE(${patch.phone ?? null}, phone),
        role       = COALESCE(${patch.role ?? null}, role),
        is_default = COALESCE(${patch.isDefault ?? null}, is_default),
        is_active  = COALESCE(${patch.isActive ?? null}, is_active)
       WHERE id = ${driverId}::uuid
      RETURNING id
    `;
  });

  return { ok: rows.length > 0 };
}

export type DeleteDriverResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "has_bookings"; bookings?: number };

/**
 * Removes a driver, but only one who never worked.
 *
 * `bookings.assigned_driver` is ON DELETE SET NULL, so deleting a driver with
 * history would silently blank the driver on every booking they ever ran —
 * including completed ones. The booking_events trail would still name them, but
 * the booking itself would forget, and "who took the unit to Al Waab in March?"
 * would become unanswerable from the record that matters.
 *
 * So this is for the typo case only: someone added with the wrong number, five
 * minutes ago, who has never been dispatched. Anyone with even one booking is
 * DEACTIVATED instead, which is what the UI steers to — they stop appearing in
 * the dispatch list and the history stays intact.
 *
 * Deleting also cascades to `user_roles`, revoking that person's login. That is
 * correct and is another reason to refuse it for anyone real.
 */
export async function deleteDriver(
  session: AdminSession,
  driverId: string,
): Promise<DeleteDriverResult> {
  const [counts] = await sql<{ bookings: number }[]>`
    SELECT count(*)::int AS bookings FROM bookings
     WHERE assigned_driver = ${driverId}::uuid
  `;

  if (counts.bookings > 0) {
    return { ok: false, code: "has_bookings", bookings: counts.bookings };
  }

  const removed = await asUser(session.userId, async (tx) => {
    return tx<{ id: string }[]>`
      DELETE FROM dispatch_recipients WHERE id = ${driverId}::uuid RETURNING id
    `;
  });

  return removed.length > 0 ? { ok: true } : { ok: false, code: "not_found" };
}

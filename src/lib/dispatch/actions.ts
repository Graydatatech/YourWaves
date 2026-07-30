import "server-only";

import { sql } from "@/db/client";
import type { BookingStatus } from "@/lib/admin/types";
import type { DispatchJob } from "./service";

/**
 * What a recipient can do from the job sheet, and what each action means.
 *
 * The three buttons are deliberately not "set status to X": a driver thinks in
 * terms of what they just did, and the mapping to the state machine is our
 * problem, not theirs.
 *
 *   on_my_way      → en_route
 *   setup_complete → NO status change (see below)
 *   job_complete   → completed
 *
 * `setup_complete` has no matching `booking_status` — the enum goes
 * assigned → en_route → completed, and §4g already flagged that the SRS lists
 * "setup complete" as an update with no state behind it. Rather than invent an
 * enum value, it fires the customer notification and writes an event. The crew
 * gets to tell the customer the wave is ready; the booking stays en_route,
 * which is true — they are on site and not finished.
 */
export const DISPATCH_ACTIONS = [
  "on_my_way",
  "setup_complete",
  "job_complete",
] as const;

export type DispatchAction = (typeof DISPATCH_ACTIONS)[number];

export function isDispatchAction(value: string): value is DispatchAction {
  return (DISPATCH_ACTIONS as readonly string[]).includes(value);
}

/** The status each action moves the booking to, or null when it moves nothing. */
const TARGET_STATUS: Record<DispatchAction, BookingStatus | null> = {
  on_my_way: "en_route",
  setup_complete: null,
  job_complete: "completed",
};

export type ActionOutcome =
  /** Applied now. */
  | "applied"
  /** This exact client action was already applied — a replayed offline queue. */
  | "duplicate"
  /** The booking is already past this point; treated as success, see below. */
  | "already_done"
  | "illegal_transition"
  | "failed";

export type ActionResult = {
  outcome: ActionOutcome;
  status: BookingStatus;
};

/**
 * Applies one action from the job sheet.
 *
 * IDEMPOTENT BY `clientActionId`. A driver taps "On my way" in a tunnel; the
 * request fails, the browser queues it, and it is replayed on reconnect —
 * possibly twice, possibly after they tapped again. The unique constraint on
 * (dispatch_id, client_action_id) means a replay is recorded once and applied
 * once, and the caller can tell the difference.
 *
 * `already_done` is reported as SUCCESS to the device on purpose. If the queue
 * replays "on my way" after the driver has already reached "completed", the
 * right answer is "yes, that happened" — not an error that makes the app retry
 * forever or, worse, show a failure for something that did occur.
 */
export async function applyDispatchAction(
  job: DispatchJob,
  action: DispatchAction,
  clientActionId: string,
): Promise<ActionResult> {
  const target = TARGET_STATUS[action];

  // Claim the idempotency key first. If this insert conflicts, the action has
  // already been handled and nothing else should run.
  const claimed = await sql<{ id: string }[]>`
    INSERT INTO booking_dispatch_actions
      (dispatch_id, client_action_id, action, outcome)
    VALUES (${job.dispatchId}::uuid, ${clientActionId}, ${action}, 'pending')
    ON CONFLICT (dispatch_id, client_action_id) DO NOTHING
    RETURNING id
  `;

  if (claimed.length === 0) {
    const [current] = await sql<{ status: BookingStatus }[]>`
      SELECT status::text AS status FROM bookings WHERE id = ${job.bookingId}::uuid
    `;
    return { outcome: "duplicate", status: current.status };
  }

  const actionRowId = claimed[0].id;

  const [before] = await sql<{ status: BookingStatus }[]>`
    SELECT status::text AS status FROM bookings WHERE id = ${job.bookingId}::uuid
  `;

  // Attribution is the recipient's PHONE, not a user id — there is no account.
  // That is what makes the audit trail say which of three people on this job
  // pressed the button.
  const actor = `${job.recipientName} <${job.recipientPhone}>`;

  async function record(outcome: ActionOutcome) {
    await sql`
      UPDATE booking_dispatch_actions SET outcome = ${outcome}
       WHERE id = ${actionRowId}::uuid
    `;
  }

  // --- an action with no status behind it --------------------------------
  if (target === null) {
    await sql`
      INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, actor_id, metadata)
      VALUES (
        ${job.bookingId}::uuid, ${before.status}::booking_status,
        ${before.status}::booking_status, 'driver', ${actor},
        ${JSON.stringify({
          reason: "setup_complete",
          dispatch_id: job.dispatchId,
          recipient_phone: job.recipientPhone,
        })}::text::jsonb
      )
    `;
    await sql`
      SELECT enqueue_booking_notifications(
        ${job.bookingId}::uuid, 'booking_setup_complete', false)
    `;
    await record("applied");
    return { outcome: "applied", status: before.status };
  }

  // Already there, or already past it. A replayed queue must not fail.
  if (before.status === target || isPast(before.status, target)) {
    await record("already_done");
    return { outcome: "already_done", status: before.status };
  }

  try {
    /**
     * "On my way" from `confirmed` walks through `assigned` first.
     *
     * The dispatch fires the moment a payment confirms, before anybody has
     * touched the back office, so the recipient's booking is normally still
     * `confirmed` — and the state machine has no confirmed → en_route edge.
     * Without this, the job sheet draws a button that always 409s, which is the
     * exact UI/SQL disagreement §4h warns about.
     *
     * Tapping the button IS taking the job, so recording `assigned` first is
     * true rather than a workaround, and it keeps the machine intact: two legal
     * steps, both attributed to the phone that pressed it, both audited.
     * `assigned_driver` is deliberately left alone — the office decides whose
     * name is on the booking, and setting it here would fire the trigger that
     * messages a driver who is already standing in the van.
     */
    if (action === "on_my_way" && before.status === "confirmed") {
      await sql`
        SELECT transition_booking_status(
          ${job.bookingId}::uuid, 'assigned'::booking_status,
          'driver'::actor_type, ${actor},
          ${JSON.stringify({
            reason: "dispatch_self_assign",
            dispatch_id: job.dispatchId,
            recipient_phone: job.recipientPhone,
          })}::text::jsonb
        )
      `;
    }

    await sql`
      SELECT transition_booking_status(
        ${job.bookingId}::uuid, ${target}::booking_status,
        'driver'::actor_type, ${actor},
        ${JSON.stringify({
          reason: `dispatch_${action}`,
          dispatch_id: job.dispatchId,
          recipient_phone: job.recipientPhone,
        })}::text::jsonb
      )
    `;
    await record("applied");
    return { outcome: "applied", status: target };
  } catch (error) {
    // 23514 is the check_violation transition_booking_status raises for an
    // illegal move. The database is the authority here exactly as it is for the
    // admin: a POST with a valid token still cannot skip a step.
    if ((error as { code?: string }).code === "23514") {
      await record("illegal_transition");
      return { outcome: "illegal_transition", status: before.status };
    }
    await record("failed");
    throw error;
  }
}

/** Booking lifecycle order, for "have we already gone past this?". */
const ORDER: BookingStatus[] = [
  "holding",
  "pending",
  "confirmed",
  "assigned",
  "en_route",
  "completed",
];

function isPast(current: BookingStatus, target: BookingStatus): boolean {
  const a = ORDER.indexOf(current);
  const b = ORDER.indexOf(target);
  return a !== -1 && b !== -1 && a > b;
}

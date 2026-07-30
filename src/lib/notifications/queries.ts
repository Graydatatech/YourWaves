import "server-only";

import { sql } from "@/db/client";

/**
 * Reads and actions for the admin notifications log (phase 8 renders these).
 *
 * Kept here rather than in src/db/queries.ts, which by its own docblock holds
 * only the queries a CUSTOMER request can reach. Nothing in this file is
 * reachable without an admin credential.
 */

export type NotificationLogEntry = {
  id: string;
  bookingId: string | null;
  reference: string | null;
  customerName: string | null;
  channel: "email" | "whatsapp";
  recipientType: "customer" | "admin" | "driver";
  recipient: string;
  templateKey: string;
  locale: string;
  status: "queued" | "sent" | "failed";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  scheduledFor: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  isWaitingForRetry: boolean;
};

type LogRow = {
  id: string;
  booking_id: string | null;
  reference: string | null;
  customer_name: string | null;
  channel: "email" | "whatsapp";
  recipient_type: "customer" | "admin" | "driver";
  recipient: string;
  template_key: string;
  locale: string;
  status: "queued" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_for: string;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
  is_waiting_for_retry: boolean;
};

function toEntry(row: LogRow): NotificationLogEntry {
  return {
    id: row.id,
    bookingId: row.booking_id,
    reference: row.reference,
    customerName: row.customer_name,
    channel: row.channel,
    recipientType: row.recipient_type,
    recipient: row.recipient,
    templateKey: row.template_key,
    locale: row.locale,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    // `to_char` in the view would lose the offset; these are instants, not
    // calendar days, so ISO strings are correct here (unlike booking_date).
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    lastAttemptAt: row.last_attempt_at
      ? new Date(row.last_attempt_at).toISOString()
      : null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    isWaitingForRetry: row.is_waiting_for_retry,
  };
}

/** Every send for one booking, newest first. */
export async function notificationsForBooking(
  bookingId: string,
): Promise<NotificationLogEntry[]> {
  const rows = await sql<LogRow[]>`
    SELECT * FROM notification_log
     WHERE booking_id = ${bookingId}::uuid
     ORDER BY created_at DESC
  `;
  return rows.map(toEntry);
}

/** The whole log, filterable. Used by the standalone admin screen. */
export async function notificationLog(options?: {
  status?: "queued" | "sent" | "failed";
  limit?: number;
}): Promise<NotificationLogEntry[]> {
  const limit = Math.min(options?.limit ?? 100, 500);
  const status = options?.status ?? null;

  const rows = await sql<LogRow[]>`
    SELECT * FROM notification_log
     WHERE (${status}::text IS NULL OR status::text = ${status})
     ORDER BY created_at DESC
     LIMIT ${limit}
  `;
  return rows.map(toEntry);
}

/** Counts for the dashboard badge: anything failed needs a human. */
export async function notificationCounts(): Promise<{
  queued: number;
  sent: number;
  failed: number;
}> {
  const rows = await sql<
    { status: "queued" | "sent" | "failed"; count: number }[]
  >`
    SELECT status::text AS status, count(*)::int AS count
      FROM notifications
     GROUP BY status
  `;

  const counts = { queued: 0, sent: 0, failed: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/**
 * Requeues a notification.
 *
 * Resets the existing row rather than inserting a new one — the dedupe index
 * would refuse a duplicate anyway — and raises max_attempts so a row that
 * already exhausted its five tries genuinely gets more.
 */
export async function resendNotification(
  id: string,
): Promise<NotificationLogEntry | null> {
  const updated = await sql<{ id: string }[]>`
    SELECT id FROM resend_notification(${id}::uuid)
  `;
  if (!updated[0]?.id) return null;

  const rows = await sql<LogRow[]>`
    SELECT * FROM notification_log WHERE id = ${id}::uuid
  `;
  return rows[0] ? toEntry(rows[0]) : null;
}

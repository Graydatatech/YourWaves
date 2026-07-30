import "server-only";

import { sql } from "@/db/client";
import { createEmailProvider, createWhatsAppSender } from "./providers";
import { renderEmail, renderWhatsApp, UnknownTemplateError } from "./render";
import { NotificationDeliveryError, type NotificationRow } from "./types";

/**
 * The outbox worker.
 *
 * Contract, in order:
 *   1. CLAIM a batch atomically (claim_notifications → FOR UPDATE SKIP LOCKED).
 *      The attempt is consumed here, so a send that crashes the process cannot
 *      be retried forever.
 *   2. RENDER and SEND each one.
 *   3. MARK sent, or failed with a reason and a retry time from the ladder.
 *
 * Nothing is sent from inside a request. A confirmation that depends on the
 * customer's browser staying open, or on a webhook handler finishing an SMTP
 * round trip before its timeout, is a confirmation that sometimes does not
 * happen — and the payment webhook in particular must return 200 fast or the
 * provider retries it.
 */

const DEFAULT_BATCH = 25;

/**
 * How long a claimed row waits before another worker may take it.
 *
 * Longer than any single send could take (providers are given 10-15s), short
 * enough that a crashed worker's messages are not stranded for a whole billing
 * cycle.
 */
const STALE_CLAIM = "5 minutes";

export type SendOutcome =
  "sent" | "skipped_no_template" | "retry_scheduled" | "failed_permanently";

export type WorkerResult = {
  claimed: number;
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
  outcomes: Array<{
    id: string;
    templateKey: string;
    channel: string;
    outcome: SendOutcome;
    error?: string;
  }>;
};

/** Sends one already-claimed row. Exported so tests can drive it directly. */
export async function deliver(
  row: NotificationRow,
): Promise<{ outcome: SendOutcome; error?: string }> {
  try {
    if (row.channel === "email") {
      const message = await renderEmail(
        row.template_key,
        row.locale,
        row.payload,
      );

      // A template with no email form is not a failure. Recording it as sent is
      // what keeps it out of the queue; leaving it queued would retry forever.
      if (!message) {
        await markSent(row.id, null);
        return { outcome: "skipped_no_template" };
      }

      const result = await createEmailProvider().send({
        to: row.recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      await markSent(row.id, result.providerRef ?? null);
      return { outcome: "sent" };
    }

    const message = renderWhatsApp(row.template_key, row.locale, row.payload);
    if (!message) {
      await markSent(row.id, null);
      return { outcome: "skipped_no_template" };
    }

    const result = await createWhatsAppSender().sendTemplate(
      row.recipient,
      message,
    );
    await markSent(row.id, result.providerRef ?? null);
    return { outcome: "sent" };
  } catch (error) {
    // An unknown template key will never resolve by waiting, so it burns no
    // further attempts — it goes straight to failed and alerts an admin.
    const retryable =
      error instanceof UnknownTemplateError
        ? false
        : error instanceof NotificationDeliveryError
          ? error.retryable
          : true;

    const message = error instanceof Error ? error.message : String(error);

    const outcome = await markFailed(row.id, message, retryable);
    return { outcome, error: message };
  }
}

async function markSent(id: string, providerRef: string | null): Promise<void> {
  await sql`SELECT mark_notification_sent(${id}::uuid, ${providerRef})`;
}

async function markFailed(
  id: string,
  error: string,
  retryable: boolean,
): Promise<SendOutcome> {
  const rows = await sql<{ mark_notification_failed: string }[]>`
    SELECT mark_notification_failed(${id}::uuid, ${error}, ${retryable})
  `;
  return rows[0]?.mark_notification_failed === "failed_permanently"
    ? "failed_permanently"
    : "retry_scheduled";
}

/**
 * Claims and sends one batch.
 *
 * Sends are SEQUENTIAL, not Promise.all. Both providers rate-limit per account
 * — Meta hard-throttles per phone number — and a burst of 25 parallel sends
 * turns a queue that would have drained into 25 rows on a backoff ladder.
 * A minute of wall clock is not a scarce resource here; a customer's trust in
 * the confirmation arriving is.
 */
export async function runNotificationWorker(options?: {
  batchSize?: number;
}): Promise<WorkerResult> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH;

  const claimed = await sql<NotificationRow[]>`
    SELECT * FROM claim_notifications(${batchSize}, ${STALE_CLAIM}::interval)
  `;

  const result: WorkerResult = {
    claimed: claimed.length,
    sent: 0,
    skipped: 0,
    retrying: 0,
    failed: 0,
    outcomes: [],
  };

  for (const row of claimed) {
    const { outcome, error } = await deliver(row);

    if (outcome === "sent") result.sent += 1;
    else if (outcome === "skipped_no_template") result.skipped += 1;
    else if (outcome === "retry_scheduled") result.retrying += 1;
    else result.failed += 1;

    result.outcomes.push({
      id: row.id,
      templateKey: row.template_key,
      channel: row.channel,
      outcome,
      error,
    });

    if (error) {
      // The recipient is logged, the message body never is: it contains the
      // customer's address and phone number.
      console.warn("[notifications/worker] send failed", {
        id: row.id,
        channel: row.channel,
        templateKey: row.template_key,
        attempts: row.attempts,
        outcome,
        error,
      });
    }
  }

  if (result.claimed > 0) {
    console.info("[notifications/worker] batch complete", {
      claimed: result.claimed,
      sent: result.sent,
      skipped: result.skipped,
      retrying: result.retrying,
      failed: result.failed,
    });
  }

  return result;
}

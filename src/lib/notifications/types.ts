import "server-only";

/**
 * The vocabulary shared by the outbox, the templates and the worker.
 *
 * `TemplateKey` is a closed union on purpose. The registry in
 * ./templates/index.ts is typed as Record<TemplateKey, …>, so adding a key here
 * without writing the template is a compile error, and a SQL function that
 * enqueues an unknown key is caught by the worker rather than silently sending
 * nothing.
 */

export const TEMPLATE_KEYS = [
  // SRS 3.4.1 — order received
  "booking_confirmed",
  // SRS 3.4.2 — new booking alert
  "admin_booking_confirmed",
  // SRS 3.4.3 — driver assignment
  "driver_assignment",
  // Phase 9 — the dispatch link. One per recipient per booking.
  "dispatch_job",
  // SRS 3.4.4 — lifecycle status updates
  "booking_assigned",
  "booking_en_route",
  "booking_setup_complete",
  "booking_completed",
  "booking_cancelled",
  // Post-activity survey — sent the day after, links to /r/<token>.
  "booking_survey",
  // Operational alerts, from phase 6 and from this phase's own failure path
  "payment_refund_required",
  "admin_payment_refund_required",
  "admin_notification_failed",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export type NotificationChannel = "email" | "whatsapp";
export type RecipientType = "customer" | "admin" | "driver";
export type NotificationLocale = "ar" | "en";

/**
 * A row as the worker sees it. Mirrors `notifications`, not `notification_log`.
 */
export type NotificationRow = {
  id: string;
  booking_id: string | null;
  channel: NotificationChannel;
  recipient_type: RecipientType;
  recipient: string;
  template_key: string;
  locale: string;
  payload: NotificationPayload;
  status: "queued" | "sent" | "failed";
  attempts: number;
  max_attempts: number;
};

/**
 * The frozen snapshot `booking_notification_payload()` writes.
 *
 * Everything is optional because a payload is written by SQL and read here
 * possibly months later, across schema changes. Templates must degrade rather
 * than throw: a missing `area` should drop a line, never fail a send that has
 * already consumed an attempt.
 */
export type NotificationPayload = {
  reference?: string;
  status?: string;
  booking_date?: string;
  preferred_start?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  address_line?: string;
  area?: string;
  city?: string;
  maps_url?: string;
  lat?: string | number;
  lng?: string | number;
  notes?: string;
  locale?: string;
  price_rental?: number;
  price_setup?: number;
  price_delivery?: number;
  price_total?: number;
  currency?: string;
  driver_name?: string;
  driver_phone?: string;
  service_areas?: string[];

  // Present only on booking_survey: the raw capability token for the survey
  // link. Carried in the payload rather than read from `reviews` at send time,
  // because the payload is frozen at enqueue — a message sent after a retry
  // must carry the token it was minted with, not one generated later.
  review_token?: string;

  // Present only on dispatch_job: the raw capability token for THIS recipient.
  dispatch_token?: string;
  dispatch_id?: string;
  recipient_name?: string;

  // Present only on admin_notification_failed.
  failed_notification_id?: string;
  failed_channel?: string;
  failed_template_key?: string;
  failed_recipient?: string;
  failed_attempts?: number;
  failed_error?: string;
};

/** What an email template produces. */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** What a WhatsApp template produces — parameters, never free-form prose. */
export type RenderedWhatsApp = {
  templateName: string;
  /** The approved language code for this locale, e.g. "ar" / "en". */
  language: string;
  bodyParams: string[];
  /** Appended to the template's URL button, when it has one. */
  buttonUrlParam?: string;
  /**
   * The message as a human would read it. NOT what is sent — Meta renders the
   * approved template from `bodyParams`. Used by the console channel, the
   * preview route and tests, so the copy can be reviewed without a Meta
   * account.
   */
  preview: string;
};

export class NotificationDeliveryError extends Error {
  constructor(
    message: string,
    /**
     * False means "the next four attempts would fail identically" — a rejected
     * template, a malformed address. The worker gives up immediately rather
     * than spending six hours discovering it.
     */
    readonly retryable = true,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

import type { NotificationPayload, TemplateKey } from "./types";

/**
 * Sample payloads for the /dev/emails preview and the template tests.
 *
 * Shaped exactly like what `booking_notification_payload()` writes, so a
 * template that renders here renders in production. Values are chosen to be
 * awkward rather than tidy — a long address that must wrap, a name with a
 * hyphen, notes present — because a preview built from ideal data hides the
 * layout bugs it exists to catch.
 */

export const SAMPLE_PAYLOAD: NotificationPayload = {
  reference: "YW-2026-0148",
  status: "confirmed",
  booking_date: "2026-08-14",
  preferred_start: "10:00:00",
  customer_name: "Noora Al-Ansari",
  customer_phone: "+97455123456",
  customer_email: "noora@example.com",
  address_line: "Villa 12, Street 850, Zone 55, near the Al Waab roundabout",
  area: "Al Waab",
  city: "Doha",
  maps_url: "https://maps.app.goo.gl/example",
  lat: 25.2599,
  lng: 51.4499,
  notes:
    "Please use the side gate — the main driveway is being resurfaced that week.",
  locale: "ar",
  price_rental: 450000,
  price_setup: 60000,
  price_delivery: 35000,
  price_total: 545000,
  currency: "QAR",
  driver_name: "Yousef Rahman",
  driver_phone: "+97455987654",
  // So /dev/emails renders the completion email WITH its review button — the
  // shape a real one has since 0019. Without it the preview shows the branch
  // that a booking with no email address takes, which is the rarer one.
  review_token: "sample-review-token-not-a-real-one",
};

/** The failure alert carries extra fields the others never have. */
export const SAMPLE_FAILURE_PAYLOAD: NotificationPayload = {
  ...SAMPLE_PAYLOAD,
  failed_notification_id: "4f1c2b8e-8a1d-4f0e-9a3c-7b2d5e6f8a90",
  failed_channel: "whatsapp",
  failed_template_key: "booking_confirmed",
  failed_recipient: "+97455123456",
  failed_attempts: 5,
  failed_error:
    "whatsapp_400: (#132000) Number of parameters does not match the expected number of params",
};

export function samplePayloadFor(
  templateKey: TemplateKey,
): NotificationPayload {
  return templateKey === "admin_notification_failed"
    ? SAMPLE_FAILURE_PAYLOAD
    : SAMPLE_PAYLOAD;
}

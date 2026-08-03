import { getSettings } from "@/db/queries";
import { normaliseTime } from "@/lib/dates";
import { toServiceAreas } from "@/lib/booking/serviceArea";
import { hasTerms } from "@/lib/booking/terms";
import { otpTarget } from "@/lib/otp";

/**
 * GET /api/settings
 *
 * The PUBLIC subset of the settings row: what the booking UI needs to render
 * prices and slot choices without a deploy.
 *
 * `admin_notification_emails` is deliberately not returned — it is internal
 * routing configuration, and publishing staff addresses invites spam. Anything
 * added to the settings table in future is opt-in here, not opt-out.
 *
 * CACHING, and why the window is short despite this changing rarely.
 *
 * Pricing and slot lists change on the order of weeks, which argues for a long
 * cache — but the cost is not symmetric. The rare day this DOES change is a day
 * the old value is actively wrong, and the server re-prices every hold from the
 * database, so a customer reading a stale price sees one number and is charged
 * another. A `stale-while-revalidate` of an hour meant exactly that: after
 * migration 0012 folded the price into a single day rate, open tabs kept
 * showing the old three-line breakdown for up to an hour.
 *
 * 60s shared + 120s stale still absorbs the burst of requests a busy hour
 * brings, while a price correction reaches everyone within about two minutes.
 */
export async function GET() {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    return Response.json(
      { error: "settings_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      currency: settings.currency,
      // Minor units (1 QAR = 100 dirhams), consistent with bookings.price_*.
      pricing: {
        rental: settings.price_rental,
        setup: settings.price_setup,
        delivery: settings.price_delivery,
        total:
          settings.price_rental +
          settings.price_setup +
          settings.price_delivery,
      },
      availableStartTimes: [...settings.available_start_times]
        .map(normaliseTime)
        .sort(),
      leadTimeHours: settings.lead_time_hours,
      maxAdvanceDays: settings.max_advance_days,
      holdMinutes: settings.hold_minutes,
      // [{en, ar}] — the booking form labels the chip in the reader's language
      // and stores the English name (see @/lib/booking/serviceArea).
      serviceAreas: toServiceAreas(settings.service_areas),
      /**
       * Whether there is anything to agree TO — not the text itself, which can
       * run to pages and belongs on /terms rather than in the payload of every
       * booking form. The wizard renders the agreement tick only when this is
       * true: a checkbox linking to an empty page asks the customer to accept
       * terms that do not exist.
       */
      termsAvailable: await hasTerms(),
      /**
       * Which contact the customer must verify — "phone" or "email".
       *
       * Derived from the active OTP channel, because a channel can only attest
       * to what it can reach. The wizard reads this to decide which field to
       * put the code box under and which value to send; the booking routes ask
       * the same question server-side. Neither trusts the other.
       */
      otpTarget: otpTarget(),
      timeZone: "Asia/Qatar",
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=60, stale-while-revalidate=120, max-age=0",
      },
    },
  );
}

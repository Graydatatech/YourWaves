import { cookies } from "next/headers";
import { bookingRequestSchema, toE164 } from "@/lib/booking/schema";
import { getBlackoutDates, getBookedDates, getSettings } from "@/db/queries";
import { computeAvailability } from "@/lib/availability";
import { normaliseTime } from "@/lib/dates";
import { OTP_COOKIE_NAME, verifyOtpToken } from "@/lib/otp/token";
import { verificationSubject } from "@/lib/otp";
import { BOOKING_FORM } from "@/lib/booking/formConfig";

/**
 * POST /api/bookings
 *
 * SCOPE: validates and logs. It does NOT create a hold or take payment — those
 * are phase 5. `create_booking_hold()` is already in the database waiting.
 * Phone verification (phase 4) IS enforced here.
 *
 * What it does do, and what matters, is prove the server never trusts the
 * client:
 *
 *   1. The payload is re-parsed with the SAME zod schema the wizard uses, so a
 *      crafted request cannot skip a rule the UI enforces.
 *   2. Availability is recomputed from the database at submit time. The
 *      browser's copy of the calendar may be up to 30s stale (the endpoint is
 *      edge-cached) and could be minutes stale if the tab has been open — so
 *      the client's belief that a date is free is treated as a hint, never as
 *      fact. A date taken in the meantime is rejected with `date_unavailable`.
 *   3. The chosen start time must be one the settings row actually offers.
 *   4. Prices are read from the database, never from the request body. A client
 *      that posts its own total is ignored.
 *   5. The phone must carry a valid verification token bound to that exact
 *      number (SRS 3.5) — see the cookie check below.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = bookingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "validation_failed",
        // Field paths only — never echo the submitted values back.
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.message,
        })),
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const draft = parsed.data;

  // --- The phone must be verified, and verified for THIS number ----------
  // SRS 3.5. The check passes the number from the request body as the expected
  // phone, so a token earned for a number the attacker controls cannot be used
  // to book against somebody else's number. `verifiedPhone` in the client draft
  // is UI state only and is deliberately not consulted here.
  const submittedPhone = toE164(draft.dialCode, draft.phoneNational);
  if (!submittedPhone) {
    return Response.json(
      {
        error: "validation_failed",
        fields: [{ path: "phoneNational", code: "invalid_phone" }],
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The gate is skipped only when the STEP IS ALSO HIDDEN — one flag drives
  // both, so the server can never demand a token for a step the form does not
  // show. See src/lib/booking/formConfig.ts for what turning it off costs.
  if (BOOKING_FORM.phoneVerification) {
    const jar = await cookies();
    const subject = verificationSubject({
      phone: submittedPhone,
      email: draft.customerEmail,
    });
    const verdict = subject
      ? verifyOtpToken(jar.get(OTP_COOKIE_NAME)?.value, subject)
      : ({ valid: false, reason: "malformed" } as const);
    if (!verdict.valid) {
      return Response.json(
        { error: "phone_not_verified", reason: verdict.reason },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  let settings;
  try {
    settings = await getSettings();
  } catch {
    return Response.json(
      { error: "settings_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // --- The start time must be a real, offered slot ------------------------
  const offered = new Set(settings.available_start_times.map(normaliseTime));
  const requestedStart = normaliseTime(draft.preferredStart);
  if (!offered.has(requestedStart)) {
    return Response.json(
      { error: "invalid_start_time" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  // --- Re-check availability against the database ------------------------
  const month = draft.bookingDate.slice(0, 7);
  const [booked, blackout] = await Promise.all([
    getBookedDates(`${month}-01`, `${month}-31`),
    getBlackoutDates(`${month}-01`, `${month}-31`),
  ]);

  const earliestStartTime = [...settings.available_start_times]
    .map(normaliseTime)
    .sort()[0];

  const days = computeAvailability({
    month,
    now: new Date(),
    leadTimeHours: settings.lead_time_hours,
    maxAdvanceDays: settings.max_advance_days,
    earliestStartTime,
    bookedDates: booked,
    blackoutDates: blackout,
  });

  const dayState = days.find((day) => day.date === draft.bookingDate)?.state;
  if (dayState !== "available") {
    return Response.json(
      {
        error: "date_unavailable",
        // Tell the client WHY so it can show the right message: a date that is
        // booked needs a different nudge than one inside the lead time.
        state: dayState ?? "out_of_range",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  // --- Accepted -----------------------------------------------------------
  // Prices come from the database, not the request.
  const priceTotal =
    settings.price_rental + settings.price_setup + settings.price_delivery;

  const payload = {
    bookingDate: draft.bookingDate,
    preferredStart: requestedStart,
    customerName: draft.customerName,
    // The E.164 number derived from the body. When verification is on, the
    // check above has already proved the token was issued for THIS number, so
    // the two are equal; with it off there is no token to read one from.
    customerPhone: submittedPhone,
    phoneVerifiedAt: BOOKING_FORM.phoneVerification
      ? new Date().toISOString()
      : null,
    customerEmail: draft.customerEmail ?? null,
    addressLine: draft.addressLine,
    area: draft.area ?? null,
    city: draft.city ?? null,
    mapsUrl: draft.mapsUrl ?? null,
    lat: draft.lat ?? null,
    lng: draft.lng ?? null,
    notes: draft.notes ?? null,
    locale: draft.locale,
    priceRental: settings.price_rental,
    priceSetup: settings.price_setup,
    priceDelivery: settings.price_delivery,
    priceTotal,
    currency: settings.currency,
  };

  // Stops here for now. Phase 5 replaces this with:
  //   select * from create_booking_hold(...)
  // and then hands off to SkipCash.
  console.info(
    "[booking] validated payload (not persisted — phases 4/5)",
    JSON.stringify({ ...payload, customerPhone: "<redacted>" }),
  );

  return Response.json(
    {
      ok: true,
      stage: "validated",
      // Echo back only what the UI needs to render a confirmation.
      bookingDate: payload.bookingDate,
      preferredStart: payload.preferredStart,
      priceTotal,
      currency: payload.currency,
      note: "Validated and phone-verified. Holds and payment arrive in phase 5.",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

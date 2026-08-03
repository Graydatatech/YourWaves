/**
 * Which parts of the booking form are switched on.
 *
 * Every field below is one the business asked to take off the page "for now",
 * so they are collected here rather than commented out where they are rendered:
 * turning one back on is a single `true`, and nothing has to be remembered
 * about which JSX was deleted.
 *
 * Everything here is OPTIONAL data except the last two flags — see their
 * notes. The
 * columns stay in the database and the schema still accepts the values, so a
 * booking taken before or after a switch flips reads back identically.
 */
export const BOOKING_FORM = {
  /** "Exact spot (optional)" — geolocation and the map picker. */
  exactSpot: false,

  /** "Anything we should know? (optional)" — the free-text notes box. */
  notes: false,

  /**
   * The customer's email address.
   *
   * REQUIRED, not optional, and that is a deliberate change from "off".
   * WhatsApp is still the channel that matters for the conversation, but the
   * confirmation email is the RECORD — reference, date, address and the full
   * price breakdown, in something the customer can find again in six weeks
   * when the crew is due. A WhatsApp thread is not that.
   *
   * It also stops SkipCash falling back to the business inbox: the gateway
   * rejects an empty Email, so without one every receipt goes to the office
   * rather than to the person who paid (see skipcash.ts).
   *
   * Optional would mean some customers silently get no record at all, which is
   * the outcome the requirement exists to prevent. To go back to optional,
   * remove the `needEmail` branch in stepValidators.details as well as
   * flipping this.
   */
  email: true,

  /**
   * The one-time-code step (SRS 3.5, §4d).
   *
   * WAS `phoneVerification`, and the rename is the point: the code now proves
   * control of whichever contact the active OTP channel can reach, which is the
   * EMAIL address today. WhatsApp still has no approved Meta template, so a
   * flag named for the phone would have described a check that verifies
   * something else — see otpTarget() in @/lib/otp.
   *
   * THIS ONE IS NOT COSMETIC. Four routes read the same flag —
   * POST /api/bookings, /hold, /[id]/checkout and /[id]/release — and stop
   * requiring the verification cookie when it is off, because a hidden step the
   * server still demanded would mean every submission returning 403. That is
   * not hypothetical: /checkout and /release were missed when the flag was
   * introduced and refused every payment for as long as it was false.
   *
   * ON requires `OTP_CHANNEL=email` and a working email transport in the
   * deployed environment. With neither set, createOtpChannel() throws in
   * production and "send code" answers 502 — loudly, by design, rather than
   * pretending to have sent something.
   */
  contactVerification: true,
} as const;

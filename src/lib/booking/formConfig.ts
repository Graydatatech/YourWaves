/**
 * Which parts of the booking form are switched on.
 *
 * Every field below is one the business asked to take off the page "for now",
 * so they are collected here rather than commented out where they are rendered:
 * turning one back on is a single `true`, and nothing has to be remembered
 * about which JSX was deleted.
 *
 * Everything here is OPTIONAL data except the last flag — see its note. The
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
   * "Verify your mobile" — the WhatsApp OTP step (SRS 3.5, §4d).
   *
   * THIS ONE IS NOT COSMETIC. `POST /api/bookings` reads the same flag and
   * stops requiring the phone-bound cookie when it is off, because a hidden
   * step the server still demanded would mean every submission returning 403.
   *
   * Turning it off means an unverified number can make a booking: a typo
   * reaches nobody, and a stranger can book against somebody else's number.
   * The whole OTP path — the rate limits, the hashing, the attempt cap, the
   * token binding — is still there and still tested; nothing was deleted.
   * Set this back to `true` before launch and the step reappears on both
   * sides at once.
   */
  phoneVerification: false,
} as const;

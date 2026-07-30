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

  /** "Email (optional)". WhatsApp is the channel that matters here. */
  email: false,

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

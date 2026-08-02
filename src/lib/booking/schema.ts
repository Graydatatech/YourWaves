import { z } from "zod";
import parsePhoneNumberFromString from "libphonenumber-js/min";
import { isIsoDate, normaliseTime } from "@/lib/dates";
import { BOOKING_FORM } from "./formConfig";

/**
 * The single validation contract, shared by the client wizard and the server
 * route. Both import this file, so a rule cannot be enforced in one place and
 * forgotten in the other.
 *
 * `libphonenumber-js/min` is the smallest metadata build — it validates real
 * number lengths and prefixes per country without shipping the full ~145KB
 * dataset. That matters on a 4G phone.
 */

export const MIN_ADDRESS_LENGTH = 10;
export const MAX_NOTES_LENGTH = 500;

/** Country codes offered by the dial-code selector. Qatar first and default. */
export const DIAL_CODES = [
  { code: "QA", dial: "+974", flag: "🇶🇦" },
  { code: "SA", dial: "+966", flag: "🇸🇦" },
  { code: "AE", dial: "+971", flag: "🇦🇪" },
  { code: "BH", dial: "+973", flag: "🇧🇭" },
  { code: "KW", dial: "+965", flag: "🇰🇼" },
  { code: "OM", dial: "+968", flag: "🇴🇲" },
  { code: "GB", dial: "+44", flag: "🇬🇧" },
  { code: "US", dial: "+1", flag: "🇺🇸" },
  { code: "IN", dial: "+91", flag: "🇮🇳" },
  { code: "PK", dial: "+92", flag: "🇵🇰" },
  { code: "PH", dial: "+63", flag: "🇵🇭" },
  { code: "EG", dial: "+20", flag: "🇪🇬" },
  { code: "LB", dial: "+961", flag: "🇱🇧" },
  { code: "JO", dial: "+962", flag: "🇯🇴" },
  { code: "TR", dial: "+90", flag: "🇹🇷" },
  { code: "FR", dial: "+33", flag: "🇫🇷" },
  { code: "DE", dial: "+49", flag: "🇩🇪" },
] as const;

export type DialCode = (typeof DIAL_CODES)[number];
export const DEFAULT_DIAL_CODE = "+974";

/**
 * Normalises a dial code + local number into E.164, returning null when the
 * combination is not a real, dialable number.
 *
 * Used by both the zod schema and the live field feedback, so the message the
 * user sees while typing is produced by the same code that will accept or
 * reject the submission.
 */
export function toE164(dial: string, national: string): string | null {
  const raw = `${dial}${national}`.replace(/[^\d+]/g, "");
  if (!raw.startsWith("+") || raw.length < 8) return null;
  const parsed = parsePhoneNumberFromString(raw);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

const isoDate = z.string().refine(isIsoDate, {
  message: "invalid_date",
});

const isoTime = z.string().refine(
  (value) => {
    try {
      normaliseTime(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid_time" },
);

/**
 * Accepts the shapes Google actually produces — google.com/maps, the
 * goo.gl/maps and maps.app.goo.gl short links, and the regional google.<tld>
 * hosts — and rejects everything else. Deliberately strict: a field that
 * accepts any URL is a field that silently collects broken links.
 */
const MAPS_HOST =
  /^(www\.)?(google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6}|goo\.gl|maps\.app\.goo\.gl)$/i;

export function isMapsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!MAPS_HOST.test(url.hostname)) return false;
    // google.<tld> is only a maps link when the path says so; the short hosts
    // are maps-only already.
    if (/^(www\.)?google\./i.test(url.hostname)) {
      return /\/maps(\/|$|\?)/.test(url.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

/** Trimmed, and empty strings collapse to undefined so `.optional()` works. */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const bookingDraftSchema = z.object({
  bookingDate: isoDate,
  preferredStart: isoTime,

  customerName: z
    .string()
    .trim()
    .min(2, { message: "name_too_short" })
    .max(120, { message: "name_too_long" }),

  dialCode: z.string().trim().min(2).max(6),
  /** The national part, as typed. Combined with dialCode below. */
  phoneNational: z.string().trim().min(4, { message: "phone_required" }),

  customerEmail: z
    .union([
      z.literal(""),
      z.string().trim().email({ message: "invalid_email" }),
    ])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  addressLine: z
    .string()
    .trim()
    .min(MIN_ADDRESS_LENGTH, { message: "address_too_short" })
    .max(300, { message: "address_too_long" }),

  area: optionalTrimmed(80),
  city: optionalTrimmed(80),

  mapsUrl: z
    .union([
      z.literal(""),
      z.string().trim().refine(isMapsUrl, { message: "invalid_maps_url" }),
    ])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),

  notes: optionalTrimmed(MAX_NOTES_LENGTH),
  locale: z.enum(["ar", "en"]),

  /**
   * The terms & conditions tick.
   *
   * OPTIONAL IN THE SCHEMA, REQUIRED BY THE ROUTE. It cannot be `z.literal(true)`
   * here because this schema is also what the wizard validates a half-filled
   * draft against, and a hard requirement would make every partial draft
   * invalid. The hold route enforces it instead, and only when terms actually
   * exist — see `assertTermsAccepted`.
   *
   * A boolean from the client is not evidence of anything on its own; what it
   * is, is the customer's assertion, recorded because the business asked for
   * the tick. The server's job is to refuse a booking that does not carry it.
   */
  termsAccepted: z.boolean().optional(),
});

export type BookingDraft = z.infer<typeof bookingDraftSchema>;

/**
 * The wizard's working state: the submittable draft plus client-only UI fields.
 *
 * `verifiedPhone` is deliberately NOT part of `bookingDraftSchema` — it never
 * travels to the server and the server would never believe it if it did.
 * Verification is proved by the signed HttpOnly cookie issued by
 * /api/otp/verify, which the client cannot read or forge. This field only tells
 * the UI which number has been verified.
 *
 * Storing the verified NUMBER rather than a boolean is what makes editing the
 * phone field clear verification automatically: the check is an equality against
 * the number currently typed, so there is no separate invalidation path that can
 * be forgotten.
 */
export type DraftState = Partial<BookingDraft> & {
  verifiedPhone?: string;
  /**
   * Whether terms exist at all, from /api/settings. Client-only, like
   * `verifiedPhone` — it tells the wizard whether to render the tick and
   * whether to insist on it, and the server decides for itself.
   */
  termsRequired?: boolean;
};

/**
 * The server contract. Extends the draft with the derived E.164 number and
 * refuses any (dial, national) pair libphonenumber cannot validate.
 */
export const bookingRequestSchema = bookingDraftSchema.superRefine(
  (value, ctx) => {
    if (!toE164(value.dialCode, value.phoneNational)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phoneNational"],
        message: "invalid_phone",
      });
    }
    // A pin is only meaningful with both halves.
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lat"],
        message: "incomplete_coordinates",
      });
    }
  },
);

/**
 * Reasons a step is not yet satisfiable.
 *
 * These are camelCase because they double as message keys under
 * `booking.errors.*` — keeping them identical means a new reason cannot be
 * added without a translation, since next-intl's typed keys would reject it.
 */
export type StepError =
  | "needDate"
  | "needTime"
  | "needAddress"
  | "invalidMapsUrl"
  | "needName"
  | "invalidPhone"
  | "invalidEmail"
  | "needVerification";

type StepValidator = (draft: DraftState) => StepError | null;

/** Field-level checks the wizard uses to gate each step. */
export const stepValidators: Record<
  "date" | "time" | "location" | "details",
  StepValidator
> = {
  date: (draft) =>
    draft.bookingDate && isIsoDate(draft.bookingDate) ? null : "needDate",

  time: (draft) => (draft.preferredStart ? null : "needTime"),

  location: (draft) => {
    const address = (draft.addressLine ?? "").trim();
    if (address.length < MIN_ADDRESS_LENGTH) return "needAddress";
    if (draft.mapsUrl && !isMapsUrl(draft.mapsUrl)) return "invalidMapsUrl";
    return null;
  },

  details: (draft) => {
    const name = (draft.customerName ?? "").trim();
    if (name.length < 2) return "needName";
    if (
      !toE164(draft.dialCode ?? DEFAULT_DIAL_CODE, draft.phoneNational ?? "")
    ) {
      return "invalidPhone";
    }
    if (
      draft.customerEmail &&
      !z.string().email().safeParse(draft.customerEmail).success
    ) {
      return "invalidEmail";
    }
    // SRS 3.5: the number must be verified before checkout. Compared against
    // the number currently entered, so editing the field revokes verification.
    // Gated by the same flag the route reads, so the step cannot be required
    // here while the server ignores it, or hidden here while the server insists.
    if (BOOKING_FORM.phoneVerification && !isPhoneVerified(draft)) {
      return "needVerification";
    }
    // Only demanded when there are terms to agree to. `termsRequired` is set
    // from /api/settings, so hiding the tick and requiring it cannot diverge.
    if (draft.termsRequired && draft.termsAccepted !== true) {
      return "needTerms";
    }
    return null;
  },
};

/** True when the number currently entered is the one that was verified. */
export function isPhoneVerified(draft: DraftState): boolean {
  if (!draft.verifiedPhone) return false;
  const current = toE164(
    draft.dialCode ?? DEFAULT_DIAL_CODE,
    draft.phoneNational ?? "",
  );
  return current !== null && current === draft.verifiedPhone;
}

export type StepKey = keyof typeof stepValidators;

/**
 * The order the wizard walks, and the order the desktop card stacks.
 *
 * Who-you-are comes BEFORE where-you-are: name and mobile are two quick fields
 * a customer can answer without leaving their chair, while the address needs
 * them to think about gate numbers and access. Asking the easy pair first means
 * that by the time someone stalls on the address we already know how to reach
 * them — and a booking that is abandoned at the last step is one we can follow
 * up, rather than an anonymous gap in the funnel.
 *
 * `location` stays last for the same reason it is the longest step.
 */
export const STEP_ORDER: readonly StepKey[] = [
  "date",
  "time",
  "details",
  "location",
];

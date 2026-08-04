import "server-only";

import type { OtpChannel } from "./channel";
import { ConsoleChannel } from "./consoleChannel";
import { WhatsAppCloudChannel } from "./whatsappChannel";
import { EmailOtpChannel } from "./emailChannel";

export { OtpDeliveryError } from "./channel";
export type { OtpChannel } from "./channel";

/**
 * The channel when OTP_CHANNEL says nothing.
 *
 * EMAIL, not console. This project verifies email addresses — WhatsApp needs a
 * Meta business account and an approved template, neither of which exists — so
 * email is the answer to "what did you mean?" rather than a guess.
 *
 * It used to be `console`, which was right when console was the only channel
 * that ran anywhere. The cost of that default once verification went live was
 * total: `console` is refused in production, so ONE unset variable made "send
 * code" answer 502 and no customer could finish a booking. Defaulting to the
 * channel the product actually uses cannot fail that way, and console is still
 * one explicit `OTP_CHANNEL=console` away for local work.
 */
const DEFAULT_CHANNEL = "email";

/**
 * Chooses the delivery channel from the environment.
 *
 * OTP_CHANNEL = "email" | "whatsapp" | "console"   (default: email)
 *
 * Selecting `console` in production remains a hard error, not a warning. A
 * deployment that quietly logs one-time codes to stdout instead of delivering
 * them would look like it worked.
 */
let cached: OtpChannel | null = null;

export function createOtpChannel(): OtpChannel {
  if (cached) return cached;

  const isProduction = process.env.NODE_ENV === "production";
  const requested = (
    process.env.OTP_CHANNEL || DEFAULT_CHANNEL
  ).toLowerCase();

  /**
   * Email. The channel that actually works today — WhatsApp needs a Meta
   * business account and an approved template, neither of which exists, so
   * `whatsapp` throws and `console` is refused in production. Requires nothing
   * beyond the email transport the notifications already use.
   */
  if (requested === "email") {
    cached = new EmailOtpChannel();
    return cached;
  }

  if (requested === "whatsapp") {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;

    const missing = [
      !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
      !accessToken && "WHATSAPP_ACCESS_TOKEN",
      !templateName && "WHATSAPP_OTP_TEMPLATE_NAME",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `OTP_CHANNEL=whatsapp but missing: ${missing.join(", ")}. ` +
          "See docs/whatsapp-setup.md.",
      );
    }

    cached = new WhatsAppCloudChannel({
      phoneNumberId: phoneNumberId!,
      accessToken: accessToken!,
      templateName: templateName!,
      languageFor: (locale) =>
        locale === "ar"
          ? (process.env.WHATSAPP_OTP_TEMPLATE_LANG_AR ?? "ar")
          : (process.env.WHATSAPP_OTP_TEMPLATE_LANG_EN ?? "en"),
    });
    return cached;
  }

  if (isProduction) {
    // Only reachable now by asking for `console` outright, or by a typo — a
    // misspelt channel must not silently become the default one.
    throw new Error(
      `OTP_CHANNEL=${requested} is not deliverable in production. Use 'email' ` +
        "(the default) or 'whatsapp'. The console channel only logs codes to " +
        "stdout and delivers nothing.",
    );
  }

  cached = new ConsoleChannel();
  return cached;
}

/** Test seam: forget the memoised channel. */
export function resetOtpChannel(): void {
  cached = null;
}

/**
 * What the active channel verifies — "phone" or "email".
 *
 * Read by the booking routes, the wizard and the token binding so all four
 * agree on which field a verification attests to. Deriving it from the channel
 * rather than a separate variable is what stops the two drifting: a deployment
 * cannot end up emailing codes while checking phone numbers.
 */
/**
 * Which contact the active channel can attest to — WITHOUT constructing it.
 *
 * Deliberately total. `createOtpChannel()` throws on a misconfiguration, which
 * is right at the moment of sending: refusing to deliver beats pretending to.
 * But this question is also asked by GET /api/settings, which every visitor
 * hits to render the booking form — so deriving the answer through the factory
 * meant one unset env var returned 500 there and took the whole form down for
 * people who were never going to reach the verification step. A config fault
 * must break the thing it configures, not the thing next to it.
 *
 * The mapping is the same one the factory uses, read from the same variables,
 * so the two cannot disagree about a channel that does construct.
 */
export function otpTarget(): "phone" | "email" {
  const requested = (
    process.env.OTP_CHANNEL || DEFAULT_CHANNEL
  ).toLowerCase();
  if (requested === "whatsapp") return "phone";
  if (requested === "email") return "email";
  // console, or something unrecognised: follow OTP_TARGET, default email.
  return process.env.OTP_TARGET === "phone" ? "phone" : "email";
}

/**
 * Which value a token must attest to for this booking.
 *
 * Four routes check verification — create, hold, checkout and release — and
 * each has both the phone and the email to hand. Deriving the subject in one
 * place is what stops three of them agreeing and the fourth checking the wrong
 * field, which would present as "verification works until you try to pay".
 *
 * Returns null when the channel targets a contact this booking does not have —
 * an email-verifying deployment and a booking taken before the field was
 * collected. The caller treats that as unverifiable rather than as verified.
 */
export function verificationSubject(contact: {
  phone: string | null | undefined;
  email: string | null | undefined;
}): string | null {
  if (otpTarget() === "email") {
    const email = contact.email?.trim().toLowerCase();
    return email && email !== "" ? email : null;
  }
  return contact.phone && contact.phone !== "" ? contact.phone : null;
}

import "server-only";

import type { OtpChannel } from "./channel";
import { ConsoleChannel } from "./consoleChannel";
import { WhatsAppCloudChannel } from "./whatsappChannel";

export { OtpDeliveryError } from "./channel";
export type { OtpChannel } from "./channel";

/**
 * Chooses the delivery channel from the environment.
 *
 * OTP_CHANNEL = "whatsapp" | "console"
 *
 * The default is `console` so a fresh checkout runs without Meta credentials —
 * but selecting or defaulting to `console` in production is a hard error, not a
 * warning. A production deployment that quietly logs one-time codes to stdout
 * instead of delivering them would look like it worked.
 */
let cached: OtpChannel | null = null;

export function createOtpChannel(): OtpChannel {
  if (cached) return cached;

  const isProduction = process.env.NODE_ENV === "production";
  const requested = (process.env.OTP_CHANNEL ?? "console").toLowerCase();

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
    throw new Error(
      "OTP_CHANNEL must be 'whatsapp' in production. The console channel only " +
        "logs codes to stdout and delivers nothing.",
    );
  }

  cached = new ConsoleChannel();
  return cached;
}

/** Test seam: forget the memoised channel. */
export function resetOtpChannel(): void {
  cached = null;
}

import "server-only";

import {
  ConsoleEmailProvider,
  ResendEmailProvider,
  type EmailProvider,
} from "./email";
import {
  ConsoleWhatsAppSender,
  WhatsAppCloudSender,
  type WhatsAppSender,
} from "./whatsapp";

export * from "./email";
export * from "./whatsapp";

/**
 * Transport selection.
 *
 *   EMAIL_PROVIDER    = resend | console   (default: console)
 *   WHATSAPP_PROVIDER = cloud   | console   (default: console)
 *
 * Both default to console so a fresh clone runs with no accounts, and both
 * REFUSE to be console in production — the same rule as `OTP_CHANNEL` in phase
 * 4 and `PAYMENT_PROVIDER` in phase 6, for the same reason: a silent no-op is
 * indistinguishable from success until a customer complains that nobody told
 * them their booking was confirmed.
 */

let emailProvider: EmailProvider | null = null;
let whatsappSender: WhatsAppSender | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function createEmailProvider(): EmailProvider {
  if (emailProvider) return emailProvider;

  const requested = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();

  if (requested === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(
      Boolean,
    );

    if (missing.length > 0) {
      throw new Error(
        `EMAIL_PROVIDER=resend but missing: ${missing.join(", ")}. ` +
          "See docs/notifications-setup.md.",
      );
    }

    emailProvider = new ResendEmailProvider({
      apiKey: apiKey!,
      from: from!,
      replyTo: process.env.EMAIL_REPLY_TO,
    });
    return emailProvider;
  }

  if (isProduction()) {
    throw new Error(
      "EMAIL_PROVIDER must be a real provider in production. The console " +
        "transport delivers nothing while reporting success.",
    );
  }

  emailProvider = new ConsoleEmailProvider();
  return emailProvider;
}

export function createWhatsAppSender(): WhatsAppSender {
  if (whatsappSender) return whatsappSender;

  const requested = (process.env.WHATSAPP_PROVIDER ?? "console").toLowerCase();

  if (requested === "cloud") {
    // Shared with the phase-4 OTP channel: the same business number sends both.
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const missing = [
      !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
      !accessToken && "WHATSAPP_ACCESS_TOKEN",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `WHATSAPP_PROVIDER=cloud but missing: ${missing.join(", ")}. ` +
          "See docs/whatsapp-setup.md.",
      );
    }

    whatsappSender = new WhatsAppCloudSender({
      phoneNumberId: phoneNumberId!,
      accessToken: accessToken!,
    });
    return whatsappSender;
  }

  if (isProduction()) {
    throw new Error(
      "WHATSAPP_PROVIDER must be 'cloud' in production. The console transport " +
        "delivers nothing while reporting success.",
    );
  }

  whatsappSender = new ConsoleWhatsAppSender();
  return whatsappSender;
}

/** Test seam, mirroring resetPaymentProvider(). */
export function resetNotificationProviders(): void {
  emailProvider = null;
  whatsappSender = null;
}

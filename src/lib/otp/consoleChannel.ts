import "server-only";

import type { OtpChannel } from "./channel";

/**
 * Development channel: prints the code to the server log instead of sending it.
 *
 * This is what makes the flow runnable without a Meta business account, an
 * approved template or per-message costs. It is selected explicitly by
 * OTP_CHANNEL=console, and `createOtpChannel()` refuses to select it in
 * production — a silent fallback to "log the secret to stdout" is exactly the
 * kind of thing that survives to launch unnoticed.
 */
export class ConsoleChannel implements OtpChannel {
  readonly name = "console";
  /**
   * Follows OTP_TARGET, defaulting to email.
   *
   * The console channel prints wherever it is pointed, so its target is not a
   * property of the transport — it is whatever the developer is standing in for.
   * Email is the default because that is what a real deployment uses today; set
   * OTP_TARGET=phone to rehearse the WhatsApp flow locally.
   */
  readonly target =
    process.env.OTP_TARGET === "phone" ? ("phone" as const) : ("email" as const);

  async send(phone: string, code: string, locale: "ar" | "en"): Promise<void> {
    // Deliberately loud: this must be impossible to mistake for a real send.
    console.warn(
      [
        "",
        "  ┌──────────────────────────────────────────────┐",
        "  │  OTP — DEV CONSOLE CHANNEL (not delivered)   │",
        `  │  phone : ${phone.padEnd(35)}│`,
        `  │  code  : ${code.padEnd(35)}│`,
        `  │  locale: ${locale.padEnd(35)}│`,
        "  └──────────────────────────────────────────────┘",
        "",
      ].join("\n"),
    );
  }
}

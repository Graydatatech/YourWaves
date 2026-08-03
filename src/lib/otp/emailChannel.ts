import "server-only";

import { createEmailProvider } from "@/lib/notifications/providers";
import { OtpDeliveryError, type OtpChannel } from "./channel";

/**
 * One-time codes by email.
 *
 * Exists because WhatsApp cannot deliver anything until Meta approves a
 * business account and a template, and until then `OTP_CHANNEL=whatsapp` throws
 * and `console` is refused in production — which left no way to verify anybody
 * on a deployed site. Email is provisioned, so this is the channel that works.
 *
 * TARGET IS EMAIL, not phone. The code proves control of the address it was
 * sent to and nothing else, so the token binds to the email and the booking
 * routes check the email. Marking a phone "verified" because somebody read
 * their inbox would be a lie the whole mechanism exists to prevent.
 *
 * Reuses the notification transport rather than talking to Resend directly:
 * one place holds the API key, one place decides console-vs-real, and one place
 * refuses to be a no-op in production.
 *
 * NOT a registered notification template. Those are keyed by booking and frozen
 * at enqueue; this is a synchronous send with no booking attached, and it must
 * not be queued — a verification code that arrives a minute later has expired
 * into uselessness.
 */
export class EmailOtpChannel implements OtpChannel {
  readonly name = "email";
  readonly target = "email" as const;

  async send(
    destination: string,
    code: string,
    locale: "ar" | "en",
  ): Promise<void> {
    const isArabic = locale === "ar";
    const dir = isArabic ? "rtl" : "ltr";

    const subject = isArabic
      ? `${code} — رمز التحقق من يورويفز`
      : `${code} — your YourWaves code`;

    const heading = isArabic ? "رمز التحقق" : "Your verification code";
    const body = isArabic
      ? "أدخل هذا الرمز لمتابعة حجزك. صالح لعشر دقائق."
      : "Enter this code to continue your booking. It expires in ten minutes.";
    const ignore = isArabic
      ? "إن لم تطلب هذا الرمز، تجاهل هذه الرسالة."
      : "If you did not request this code, you can ignore this email.";

    /**
     * Hand-written table markup rather than the notification templates, for the
     * reason §4g gives: Outlook renders with the Word engine — no flexbox, no
     * grid — and Gmail strips <style> blocks. Every rule is inline.
     *
     * The code itself is `dir="ltr"` and letter-spaced: four digits inside an
     * Arabic sentence must not be reordered, and a spaced code is markedly
     * easier to copy from a phone.
     */
    const html = `<!doctype html>
<html dir="${dir}" lang="${locale}">
<body style="margin:0;padding:24px;background-color:#eef5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Arabic',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;">
<tr><td style="padding:32px;text-align:${isArabic ? "right" : "left"};" dir="${dir}">
<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0b2a3d;">${heading}</p>
<p style="margin:0 0 24px;font-size:16px;line-height:26px;color:#425a6b;">${body}</p>
<p dir="ltr" style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:10px;color:#04141f;">${code}</p>
<p style="margin:0;font-size:13px;line-height:20px;color:#4c6475;">${ignore}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    const text = `${heading}\n\n${code}\n\n${body}\n\n${ignore}`;

    try {
      await createEmailProvider().send({
        to: destination,
        subject,
        html,
        text,
        // Deliberately no idempotency key: every request for a code is a NEW
        // code, and deduplicating two of them would send the customer a code
        // the server has already superseded.
      });
    } catch (cause) {
      // Retryable: the caller has already recorded the send against the rate
      // limit, and a transport hiccup should not burn the customer's quota
      // silently.
      throw new OtpDeliveryError("otp_email_failed", cause, true);
    }
  }
}

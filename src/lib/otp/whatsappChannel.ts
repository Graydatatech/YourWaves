import "server-only";

import { OtpDeliveryError, type OtpChannel } from "./channel";

/**
 * WhatsApp Cloud API (Meta Graph API) delivery.
 *
 * Sends an **authentication-category template**, not a free-form message. That
 * is not a stylistic choice: WhatsApp only permits business-initiated messages
 * through pre-approved templates, and only the `AUTHENTICATION` category is
 * allowed to carry a one-time code. A free-form send to a user who has not
 * messaged you in the last 24 hours is rejected outright.
 *
 * The template must exist in the client's WhatsApp Business account with:
 *   - category AUTHENTICATION
 *   - exactly ONE body parameter (the code)
 *   - a copy-code button
 *   - approved localisations for `ar` and `en`
 *
 * See docs/whatsapp-setup.md for the provisioning steps. Template names and
 * languages are configured, not hardcoded, so the client can rename or add
 * locales without a code change.
 */

const GRAPH_VERSION = "v21.0";

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  /** Maps our locale to the template's approved language code. */
  languageFor: (locale: "ar" | "en") => string;
};

export class WhatsAppCloudChannel implements OtpChannel {
  readonly name = "whatsapp";
  /** Reaches a phone, so a phone is what it can attest to. */
  readonly target = "phone" as const;

  constructor(private readonly config: WhatsAppConfig) {}

  async send(phone: string, code: string, locale: "ar" | "en"): Promise<void> {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`;

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      // Graph wants the number without a leading "+".
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: this.config.templateName,
        language: { code: this.config.languageFor(locale) },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }],
          },
          {
            // The copy-code button takes the same code as its payload. An
            // authentication template is rejected at send time if this is
            // missing, even though the button text itself is fixed by Meta.
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        // A hung Graph call must not hold the request open indefinitely.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new OtpDeliveryError("whatsapp_unreachable", cause, true);
    }

    if (response.ok) return;

    let parsed: GraphErrorBody = {};
    try {
      parsed = (await response.json()) as GraphErrorBody;
    } catch {
      // Non-JSON error body; the status is enough to classify.
    }

    // 5xx and 429 are worth retrying; a 4xx means our request or the template
    // is wrong and retrying will fail identically.
    const retryable = response.status >= 500 || response.status === 429;

    // Log the diagnostic fields but never the code or the access token.
    console.error("[otp/whatsapp] send failed", {
      status: response.status,
      code: parsed.error?.code,
      subcode: parsed.error?.error_subcode,
      type: parsed.error?.type,
      message: parsed.error?.message,
      fbtrace_id: parsed.error?.fbtrace_id,
    });

    throw new OtpDeliveryError(
      `whatsapp_error_${response.status}`,
      parsed.error,
      retryable,
    );
  }
}

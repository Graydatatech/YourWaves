import "server-only";

import { NotificationDeliveryError, type RenderedWhatsApp } from "../types";

/**
 * WhatsApp Cloud API, for business-initiated NOTIFICATIONS.
 *
 * Separate from phase 4's `WhatsAppCloudChannel`, which sends the OTP. That one
 * is hard-wired to a single AUTHENTICATION template with a copy-code button;
 * this one sends arbitrary UTILITY templates with N body parameters. Merging
 * them would mean one class with an authentication-shaped special case, and the
 * two have genuinely different Meta approval rules.
 *
 * Business-initiated messages MUST use a pre-approved template. Free-form text
 * is only permitted inside a 24-hour customer service window, which a
 * confirmation sent minutes after payment is NOT reliably inside — the customer
 * paid on a web page, they did not message us. See docs/whatsapp-templates.md
 * for what the client must submit to Meta.
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

export interface WhatsAppSender {
  readonly name: string;
  sendTemplate(
    to: string,
    message: RenderedWhatsApp,
  ): Promise<{ providerRef?: string }>;
}

export type WhatsAppSenderConfig = {
  phoneNumberId: string;
  accessToken: string;
};

export class WhatsAppCloudSender implements WhatsAppSender {
  readonly name = "whatsapp_cloud";

  constructor(private readonly config: WhatsAppSenderConfig) {}

  async sendTemplate(
    to: string,
    message: RenderedWhatsApp,
  ): Promise<{ providerRef?: string }> {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.config.phoneNumberId}/messages`;

    const components: unknown[] = [
      {
        type: "body",
        parameters: message.bodyParams.map((text) => ({ type: "text", text })),
      },
    ];

    // A dynamic URL button carries the variable part of its link as a
    // parameter; the base URL is fixed in the approved template.
    if (message.buttonUrlParam !== undefined) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: message.buttonUrlParam }],
      });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          // Graph wants the number without a leading "+".
          to: to.replace(/^\+/, ""),
          type: "template",
          template: {
            name: message.templateName,
            language: { code: message.language },
            components,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new NotificationDeliveryError("whatsapp_unreachable", true, cause);
    }

    if (response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
      };
      return { providerRef: parsed.messages?.[0]?.id };
    }

    let parsed: GraphErrorBody = {};
    try {
      parsed = (await response.json()) as GraphErrorBody;
    } catch {
      // Status alone is enough to classify.
    }

    // 5xx/429 are transient. A 4xx means the template, the language or the
    // number is wrong, and four more attempts would fail identically.
    const retryable = response.status >= 500 || response.status === 429;

    console.error("[notifications/whatsapp] send failed", {
      status: response.status,
      template: message.templateName,
      language: message.language,
      code: parsed.error?.code,
      subcode: parsed.error?.error_subcode,
      message: parsed.error?.message,
      fbtrace_id: parsed.error?.fbtrace_id,
    });

    throw new NotificationDeliveryError(
      `whatsapp_${response.status}: ${parsed.error?.message ?? "unknown"}`,
      retryable,
      parsed.error,
    );
  }
}

/**
 * Development transport. Prints the message as the customer would read it,
 * which is the only way to review WhatsApp copy without an approved template.
 */
export class ConsoleWhatsAppSender implements WhatsAppSender {
  readonly name = "console";

  async sendTemplate(
    to: string,
    message: RenderedWhatsApp,
  ): Promise<{ providerRef?: string }> {
    console.info(
      `[notifications/console] WHATSAPP → ${to}\n` +
        `  template: ${message.templateName} (${message.language})\n` +
        message.preview
          .split("\n")
          .map((line) => `  | ${line}`)
          .join("\n"),
    );
    return { providerRef: `console_${Date.now().toString(36)}` };
  }
}

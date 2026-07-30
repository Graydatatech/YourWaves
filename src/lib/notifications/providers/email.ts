import "server-only";

import { NotificationDeliveryError } from "../types";

/**
 * The email boundary.
 *
 * Same shape as the payment provider: one interface, a real implementation and
 * a development one, chosen by an env var, and the development one is a hard
 * error in production. A deployment that silently dropped every confirmation
 * email would look exactly like a working one.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  /** Always sent alongside the HTML. Some corporate clients show only this. */
  text: string;
  replyTo?: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<{ providerRef?: string }>;
}

/**
 * Resend (https://resend.com) over plain fetch.
 *
 * Deliberately not their SDK: the call is one POST, and this project already
 * treats provider wire formats as something to own rather than depend on — the
 * same reasoning as SkipCash in phase 6.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly config: {
      apiKey: string;
      /** Must be a verified domain on the account, e.g. "YourWaves <hello@yourwaves.qa>". */
      from: string;
      replyTo?: string;
    },
  ) {}

  async send(message: OutboundEmail): Promise<{ providerRef?: string }> {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo ?? this.config.replyTo,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new NotificationDeliveryError("resend_unreachable", true, cause);
    }

    if (response.ok) {
      const parsed = (await response.json().catch(() => ({}))) as {
        id?: string;
      };
      return { providerRef: parsed.id };
    }

    const detail = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    // 4xx other than 429 means this message will never be accepted: a bad
    // address, an unverified sender, a payload Resend rejects. Retrying burns
    // the remaining attempts and delays the admin alert by six hours.
    const retryable = response.status >= 500 || response.status === 429;

    console.error("[notifications/resend] send failed", {
      status: response.status,
      name: detail.name,
      message: detail.message,
    });

    throw new NotificationDeliveryError(
      `resend_${response.status}: ${detail.name ?? detail.message ?? "unknown"}`,
      retryable,
    );
  }
}

/**
 * Development transport. Logs a summary and, when NOTIFICATION_DEV_DIR is set,
 * writes the rendered HTML to disk so it can be opened in a browser.
 *
 * Writing the file is not a nicety: the /dev/emails preview renders templates
 * from sample data, whereas these are the exact bytes a real booking produced.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: OutboundEmail): Promise<{ providerRef?: string }> {
    const ref = `console_${Date.now().toString(36)}`;
    const dir = process.env.NOTIFICATION_DEV_DIR;

    if (dir) {
      try {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        await mkdir(dir, { recursive: true });
        const safe = message.subject.replace(/[^\w\-]+/g, "_").slice(0, 60);
        await writeFile(join(dir, `${ref}_${safe}.html`), message.html, "utf8");
      } catch (error) {
        // Never fail a send because the debugging artefact could not be written.
        console.warn("[notifications/console] could not write preview", error);
      }
    }

    console.info(
      `[notifications/console] EMAIL → ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `  text: ${message.text.replace(/\s+/g, " ").slice(0, 160)}…`,
    );
    return { providerRef: ref };
  }
}

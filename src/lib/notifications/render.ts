import "server-only";

import { render } from "@react-email/render";
import { buildContext } from "./templates/context";
import { TEMPLATES } from "./templates";
import {
  isTemplateKey,
  type NotificationLocale,
  type NotificationPayload,
  type RenderedEmail,
  type RenderedWhatsApp,
} from "./types";

/**
 * Turning an outbox row into something a provider can accept.
 *
 * Rendering happens at SEND time, not enqueue time, deliberately: a template
 * fix (a typo, a broken link, a layout bug in Outlook) then applies to every
 * message still queued, including ones waiting out a six-hour backoff. Storing
 * rendered HTML in the row would freeze the bug alongside the data.
 *
 * What IS frozen is the payload — see booking_notification_payload() in
 * migration 0007. Data as it was, presentation as it is now.
 */

function normaliseLocale(locale: string): NotificationLocale {
  return locale === "ar" ? "ar" : "en";
}

export class UnknownTemplateError extends Error {
  constructor(readonly templateKey: string) {
    super(`unknown_template:${templateKey}`);
    this.name = "UnknownTemplateError";
  }
}

/**
 * `null` means "this key deliberately sends nothing on this channel" — the
 * worker records it as sent without contacting a provider. Distinct from an
 * unknown key, which throws, because one is a decision and the other is a bug.
 */
export async function renderEmail(
  templateKey: string,
  locale: string,
  payload: NotificationPayload,
): Promise<RenderedEmail | null> {
  if (!isTemplateKey(templateKey)) throw new UnknownTemplateError(templateKey);

  const definition = TEMPLATES[templateKey];
  if (!definition.email) return null;

  const ctx = buildContext(payload, normaliseLocale(locale));
  const element = definition.email.render(ctx);

  const subject = ctx.t(
    // The catalogue is typed, but these keys are assembled from the registry,
    // so the cast is where that type safety necessarily ends. The
    // template-registry test renders every key and would catch a bad one.
    definition.email.subjectKey as Parameters<typeof ctx.t>[0],
    definition.email.subjectValues?.(ctx),
  );

  // Two passes over the same element: the HTML clients render, and the
  // plaintext alternative for clients that refuse HTML and for spam scoring.
  const [html, text] = await Promise.all([
    render(element, { pretty: false }),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}

export function renderWhatsApp(
  templateKey: string,
  locale: string,
  payload: NotificationPayload,
): RenderedWhatsApp | null {
  if (!isTemplateKey(templateKey)) throw new UnknownTemplateError(templateKey);

  const definition = TEMPLATES[templateKey];
  if (!definition.whatsapp) return null;

  const normalised = normaliseLocale(locale);
  const ctx = buildContext(payload, normalised);
  const params = definition.whatsapp.params(ctx);

  // The preview is the catalogue message with the same values interpolated by
  // name. It is what the console transport prints and what the preview route
  // shows — never what is transmitted, which is the positional array below.
  const preview = ctx.t(
    definition.whatsapp.messageKey as Parameters<typeof ctx.t>[0],
    Object.fromEntries(params),
  );

  return {
    templateName: definition.whatsapp.templateName,
    language: (definition.whatsapp.language ?? ((l) => l))(normalised),
    bodyParams: params.map(([, value]) => value),
    preview,
  };
}

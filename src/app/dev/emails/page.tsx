import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  TEMPLATE_KEYS,
  type NotificationLocale,
} from "@/lib/notifications/types";
import { TEMPLATES } from "@/lib/notifications/templates";
import { renderEmail, renderWhatsApp } from "@/lib/notifications/render";
import { samplePayloadFor } from "@/lib/notifications/samples";

export const metadata: Metadata = {
  title: "Email previews",
  robots: { index: false, follow: false },
};

/**
 * /dev/emails — every template, both locales, from sample data.
 *
 * Development only, 404 in production, exactly like /styleguide. It renders
 * through `renderEmail`/`renderWhatsApp`, the same functions the worker calls,
 * so what appears here is what would be delivered — a preview with its own
 * rendering path would be a preview of something that does not exist.
 *
 * Emails are shown in iframes with `srcDoc`. A rendered email is a whole
 * document with its own <html> and <body>; injecting that into this page would
 * both break the page and let the email's styles escape, which is the one thing
 * a preview must not do.
 *
 * Deliberately outside `[locale]`: this is a developer tool, not a page for
 * customers, so it has no place in the localised route tree. `src/proxy.ts`
 * excludes `/dev` from the locale redirect for the same reason, and
 * `app/dev/layout.tsx` supplies the document shell the root layout does not.
 */

const LOCALES: NotificationLocale[] = ["ar", "en"];

export default async function EmailPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const selectedKey =
    params.template && TEMPLATE_KEYS.includes(params.template as never)
      ? (params.template as (typeof TEMPLATE_KEYS)[number])
      : TEMPLATE_KEYS[0];
  const selectedLocale: NotificationLocale =
    params.locale === "en" ? "en" : "ar";

  const payload = samplePayloadFor(selectedKey);
  const definition = TEMPLATES[selectedKey];

  const emailMessage = await renderEmail(selectedKey, selectedLocale, payload);
  const whatsappMessage = renderWhatsApp(selectedKey, selectedLocale, payload);

  return (
    <main
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "20px",
        maxWidth: "1200px",
        margin: "0 auto",
        color: "#0b2a3d",
      }}
    >
      <h1 style={{ fontSize: "22px", margin: "0 0 4px" }}>
        Notification previews
      </h1>
      <p style={{ color: "#4a6577", fontSize: "14px", margin: "0 0 18px" }}>
        Sample data, rendered by the same code the worker uses. Development
        only.
      </p>

      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          marginBottom: "12px",
        }}
      >
        {TEMPLATE_KEYS.map((key) => (
          <a
            key={key}
            href={`/dev/emails?template=${key}&locale=${selectedLocale}`}
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              fontSize: "13px",
              textDecoration: "none",
              border: "1px solid #dde7ee",
              background: key === selectedKey ? "#0b8fa3" : "#fff",
              color: key === selectedKey ? "#fff" : "#0b2a3d",
            }}
          >
            {key}
          </a>
        ))}
      </nav>

      <nav style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {LOCALES.map((locale) => (
          <a
            key={locale}
            href={`/dev/emails?template=${selectedKey}&locale=${locale}`}
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              fontSize: "13px",
              textDecoration: "none",
              border: "1px solid #dde7ee",
              background: locale === selectedLocale ? "#04202f" : "#fff",
              color: locale === selectedLocale ? "#fff" : "#0b2a3d",
            }}
          >
            {locale === "ar" ? "العربية (RTL)" : "English (LTR)"}
          </a>
        ))}
      </nav>

      <section style={{ marginBottom: "28px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>
          Email · audience: {definition.audience}
        </h2>
        {emailMessage ? (
          <>
            <p
              style={{
                fontSize: "13px",
                color: "#4a6577",
                margin: "0 0 10px",
                padding: "10px 12px",
                background: "#f3f9fc",
                borderRadius: "10px",
              }}
            >
              <strong>Subject:</strong> {emailMessage.subject}
            </p>
            {/* 390px is the project's baseline phone width; the iframe is
                deliberately narrow so the mobile rendering is what you see
                first, per the mobile-first rule. */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <iframe
                title={`${selectedKey}-${selectedLocale}-mobile`}
                srcDoc={emailMessage.html}
                style={{
                  width: "390px",
                  height: "780px",
                  border: "1px solid #dde7ee",
                  borderRadius: "12px",
                  background: "#fff",
                }}
              />
              <iframe
                title={`${selectedKey}-${selectedLocale}-desktop`}
                srcDoc={emailMessage.html}
                style={{
                  flex: "1 1 620px",
                  minWidth: "320px",
                  height: "780px",
                  border: "1px solid #dde7ee",
                  borderRadius: "12px",
                  background: "#fff",
                }}
              />
            </div>

            <details style={{ marginTop: "12px" }}>
              <summary style={{ cursor: "pointer", fontSize: "13px" }}>
                Plaintext alternative
              </summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "13px",
                  background: "#f3f9fc",
                  padding: "12px",
                  borderRadius: "10px",
                  color: "#0b2a3d",
                }}
              >
                {emailMessage.text}
              </pre>
            </details>
          </>
        ) : (
          <p style={{ fontSize: "14px", color: "#92400e" }}>
            No email form for this template — the worker records it as sent
            without contacting a provider.
          </p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>WhatsApp</h2>
        {whatsappMessage ? (
          <div
            style={{
              maxWidth: "390px",
              background: "#e6ffe0",
              borderRadius: "14px",
              padding: "14px 16px",
              whiteSpace: "pre-wrap",
              fontSize: "15px",
              lineHeight: "23px",
              direction: selectedLocale === "ar" ? "rtl" : "ltr",
              textAlign: selectedLocale === "ar" ? "right" : "left",
            }}
          >
            {whatsappMessage.preview}
          </div>
        ) : (
          <p style={{ fontSize: "14px", color: "#4a6577" }}>
            No WhatsApp form for this template.
          </p>
        )}

        {whatsappMessage ? (
          <p style={{ fontSize: "13px", color: "#4a6577", marginTop: "10px" }}>
            Meta template <code>{whatsappMessage.templateName}</code> (
            {whatsappMessage.language}) · {whatsappMessage.bodyParams.length}{" "}
            body parameters. The preview is the catalogue string; Meta renders
            the approved template from the positional parameters.
          </p>
        ) : null}
      </section>
    </main>
  );
}

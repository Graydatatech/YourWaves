import type { CSSProperties, ReactNode } from "react";
import { EMAIL_WIDTH, email, font } from "./theme";

/**
 * Email primitives.
 *
 * Everything here is `<table>` and inline styles, on purpose:
 *   - Outlook 2016-2021 and Outlook.com render with the WORD engine. No
 *     flexbox, no grid, no float reliability, no `max-width` on divs.
 *   - Gmail strips `<style>` blocks in several contexts (forwarded mail, the
 *     Android app's "view original"), so every rule must be on the element.
 *   - `dir` is set on the document AND on each block, because forwarding
 *     frequently drops the outer element.
 *
 * The site's Tailwind classes are unavailable here — there is no stylesheet to
 * resolve them against — so the RTL lint rule has nothing to enforce. Direction
 * is handled explicitly by `align`/`textAlign` derived from the locale.
 */

export type EmailDirection = "rtl" | "ltr";

export function directionFor(locale: string): EmailDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

/** "start"/"end" resolved for a client that does not understand logical values. */
export function startAlign(dir: EmailDirection): "left" | "right" {
  return dir === "rtl" ? "right" : "left";
}
export function endAlign(dir: EmailDirection): "left" | "right" {
  return dir === "rtl" ? "left" : "right";
}

const baseText: CSSProperties = {
  fontFamily: font.stack,
  fontSize: "16px",
  lineHeight: "26px",
  color: email.ink,
  margin: 0,
};

/**
 * The full document.
 *
 * The preheader is the grey line clients show next to the subject in the
 * inbox list. Left out, they helpfully substitute the first text they find —
 * usually "View in browser" or the logo's alt text.
 */
export function EmailShell({
  dir,
  locale,
  preheader,
  children,
  footer,
}: {
  dir: EmailDirection;
  locale: string;
  preheader: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <html dir={dir} lang={locale}>
      {/* eslint-disable-next-line @next/next/no-head-element --
          next/head is for pages in the App Router's document. This is a
          standalone email document rendered to a string by @react-email/render
          and never mounted in a browser page. */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{preheader}</title>
      </head>
      <body
        dir={dir}
        style={{
          margin: 0,
          padding: 0,
          width: "100%",
          backgroundColor: email.page,
          WebkitTextSizeAdjust: "100%",
        }}
      >
        {/* Hidden from view, read by the inbox list. The spacer characters stop
            clients from pulling body copy in after it. */}
        <div
          style={{
            display: "none",
            fontSize: "1px",
            lineHeight: "1px",
            maxHeight: 0,
            maxWidth: 0,
            opacity: 0,
            overflow: "hidden",
          }}
        >
          {preheader}
          {" ‌".repeat(60)}
        </div>

        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{
            backgroundColor: email.page,
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width={EMAIL_WIDTH}
                  cellPadding={0}
                  cellSpacing={0}
                  border={0}
                  dir={dir}
                  style={{
                    width: "100%",
                    maxWidth: `${EMAIL_WIDTH}px`,
                    borderCollapse: "collapse",
                  }}
                >
                  <tbody>{children}</tbody>
                </table>
                {footer}
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/**
 * The brand bar.
 *
 * `background-color` carries the solid; `background-image` layers the gradient
 * for clients that support it. Outlook shows the solid and looks intentional
 * rather than broken.
 */
export function EmailHeader({
  dir,
  brand,
  tagline,
}: {
  dir: EmailDirection;
  brand: string;
  tagline?: string;
}) {
  return (
    <tr>
      <td
        align={startAlign(dir)}
        style={{
          backgroundColor: email.brandSolid,
          backgroundImage: email.brandGradient,
          borderRadius: "18px 18px 0 0",
          padding: "22px 28px",
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ borderCollapse: "collapse" }}
        >
          <tbody>
            <tr>
              <td align={startAlign(dir)}>
                {/* The mark is drawn with type and a border rather than an
                    image: Gmail and Outlook block remote images by default, so
                    a logo <img> is a broken icon on first open for most
                    recipients. */}
                <span
                  style={{
                    ...baseText,
                    color: email.inkDeep,
                    fontSize: "22px",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {brand}
                </span>
                {tagline ? (
                  <div
                    style={{
                      ...baseText,
                      color: email.inkDeep,
                      fontSize: "13px",
                      lineHeight: "20px",
                      opacity: 0.75,
                      paddingTop: "2px",
                    }}
                  >
                    {tagline}
                  </div>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  );
}

/** The white body panel. */
export function EmailBody({
  dir,
  children,
}: {
  dir: EmailDirection;
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        align={startAlign(dir)}
        style={{
          backgroundColor: email.surface,
          borderRadius: "0 0 18px 18px",
          padding: "28px",
          textAlign: startAlign(dir),
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ borderCollapse: "collapse" }}
        >
          <tbody>{children}</tbody>
        </table>
      </td>
    </tr>
  );
}

/** A block inside EmailBody. Everything below is meant to sit in one of these. */
export function Block({
  dir,
  children,
  paddingTop = 0,
}: {
  dir: EmailDirection;
  children: ReactNode;
  paddingTop?: number;
}) {
  return (
    <tr>
      <td
        align={startAlign(dir)}
        style={{ textAlign: startAlign(dir), paddingTop: `${paddingTop}px` }}
      >
        {children}
      </td>
    </tr>
  );
}

export function Heading({
  dir,
  children,
}: {
  dir: EmailDirection;
  children: ReactNode;
}) {
  return (
    <h1
      style={{
        ...baseText,
        fontSize: "26px",
        lineHeight: "34px",
        fontWeight: 800,
        color: email.inkDeep,
        textAlign: startAlign(dir),
        margin: "0 0 10px",
      }}
    >
      {children}
    </h1>
  );
}

export function Paragraph({
  dir,
  children,
  muted = false,
  small = false,
}: {
  dir: EmailDirection;
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <p
      style={{
        ...baseText,
        fontSize: small ? "14px" : "16px",
        lineHeight: small ? "22px" : "26px",
        color: muted ? email.muted : email.ink,
        textAlign: startAlign(dir),
        margin: "0 0 12px",
      }}
    >
      {children}
    </p>
  );
}

/**
 * The reference block — the thing customers screenshot, so it is the largest
 * element after the heading.
 *
 * Takes no `dir`: the content is centred, and the value carries its own.
 *
 * `dir="ltr"` on the value itself is the email equivalent of the site's <Bidi>:
 * "YW-2026-0007" inside Arabic body copy would otherwise be reordered by the
 * bidirectional algorithm and render with its parts transposed.
 */
export function ReferenceBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{
        backgroundColor: email.panel,
        border: `1px solid ${email.border}`,
        borderRadius: "14px",
        borderCollapse: "separate",
      }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{ padding: "16px 20px", textAlign: "center" }}
          >
            <div
              style={{
                ...baseText,
                fontSize: "11px",
                lineHeight: "16px",
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: email.muted2,
              }}
            >
              {label}
            </div>
            <div
              dir="ltr"
              style={{
                ...baseText,
                unicodeBidi: "isolate",
                fontSize: "30px",
                lineHeight: "38px",
                fontWeight: 800,
                color: email.accentStrong,
                paddingTop: "4px",
              }}
            >
              {value}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export type DetailRow = {
  label: string;
  value: ReactNode;
  /** Numbers, dates, phones and money: isolated so RTL cannot reorder them. */
  isolate?: boolean;
  strong?: boolean;
};

/**
 * Label/value table.
 *
 * Two columns with explicit `align`, which is what makes it mirror: in RTL the
 * label sits right and the value left, matching how the site renders the same
 * data. A CSS-only approach would collapse in Outlook.
 */
export function DetailTable({
  dir,
  rows,
}: {
  dir: EmailDirection;
  rows: DetailRow[];
}) {
  const visible = rows.filter((row) => row.value !== null && row.value !== "");
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      dir={dir}
      style={{ borderCollapse: "collapse", width: "100%" }}
    >
      <tbody>
        {visible.map((row, index) => (
          <tr key={row.label}>
            <td
              align={startAlign(dir)}
              width="40%"
              style={{
                ...baseText,
                fontSize: "14px",
                lineHeight: "22px",
                color: email.muted,
                textAlign: startAlign(dir),
                padding: "10px 0",
                borderTop: index === 0 ? "none" : `1px solid ${email.border}`,
                verticalAlign: "top",
              }}
            >
              {row.label}
            </td>
            <td
              align={endAlign(dir)}
              style={{
                ...baseText,
                fontSize: "15px",
                lineHeight: "22px",
                fontWeight: row.strong ? 700 : 600,
                color: email.ink,
                textAlign: endAlign(dir),
                padding: "10px 0",
                borderTop: index === 0 ? "none" : `1px solid ${email.border}`,
                verticalAlign: "top",
              }}
            >
              {row.isolate ? (
                <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                  {row.value}
                </span>
              ) : (
                row.value
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A bulletproof button.
 *
 * Padding on the <a> plus a table wrapper, rather than a styled div: Outlook
 * ignores padding on inline elements, so the cell carries the background and
 * the anchor fills it.
 *
 * Takes no `dir`: a block-level table sits at the inline start edge on its own,
 * which the document's own direction already resolves correctly.
 */
export function EmailButton({
  href,
  children,
  variant = "brand",
}: {
  href: string;
  children: ReactNode;
  variant?: "brand" | "whatsapp" | "outline";
}) {
  const background =
    variant === "whatsapp"
      ? email.whatsapp
      : variant === "outline"
        ? email.surface
        : email.brandSolid;
  const color =
    variant === "whatsapp"
      ? "#ffffff"
      : variant === "outline"
        ? email.ink
        : email.inkDeep;

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ borderCollapse: "separate" }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{
              backgroundColor: background,
              backgroundImage:
                variant === "brand" ? email.brandGradient : "none",
              borderRadius: "999px",
              border:
                variant === "outline" ? `1px solid ${email.border}` : "none",
            }}
          >
            <a
              href={href}
              style={{
                ...baseText,
                display: "inline-block",
                padding: "14px 26px",
                fontSize: "16px",
                fontWeight: 700,
                color,
                textDecoration: "none",
                // 44px minimum tap target, the same floor the site uses.
                minHeight: "44px",
                lineHeight: "22px",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** A titled list, used for the preparation notes. */
export function BulletList({
  dir,
  title,
  items,
}: {
  dir: EmailDirection;
  title: string;
  items: string[];
}) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      dir={dir}
      style={{
        backgroundColor: email.panel,
        borderRadius: "14px",
        borderCollapse: "separate",
        width: "100%",
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "18px 20px", textAlign: startAlign(dir) }}>
            <div
              style={{
                ...baseText,
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: email.accentStrong,
                paddingBottom: "8px",
                textAlign: startAlign(dir),
              }}
            >
              {title}
            </div>
            {items.map((item) => (
              <table
                key={item}
                role="presentation"
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                dir={dir}
                style={{ borderCollapse: "collapse" }}
              >
                <tbody>
                  <tr>
                    {/* A real table cell for the marker, so the text block
                        stays aligned when it wraps — a text bullet would hang
                        under the first character on the second line. */}
                    <td
                      width="14"
                      valign="top"
                      style={{
                        ...baseText,
                        fontSize: "15px",
                        lineHeight: "24px",
                        // accentStrong, not accent: this bullet is a text
                        // glyph at 15px, so it is held to the 4.5:1 text
                        // threshold rather than the 3:1 non-text one.
                        color: email.accentStrong,
                        paddingTop: "4px",
                      }}
                    >
                      •
                    </td>
                    <td
                      style={{
                        ...baseText,
                        fontSize: "15px",
                        lineHeight: "24px",
                        color: email.muted,
                        paddingTop: "4px",
                        textAlign: startAlign(dir),
                      }}
                    >
                      {item}
                    </td>
                  </tr>
                </tbody>
              </table>
            ))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** A coloured callout for the two admin alert templates. */
export function Callout({
  dir,
  tone,
  children,
}: {
  dir: EmailDirection;
  tone: "danger" | "warning";
  children: ReactNode;
}) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      dir={dir}
      style={{
        backgroundColor: tone === "danger" ? email.dangerBg : email.warningBg,
        borderRadius: "12px",
        borderCollapse: "separate",
        width: "100%",
      }}
    >
      <tbody>
        <tr>
          <td
            style={{
              ...baseText,
              padding: "14px 18px",
              fontSize: "15px",
              lineHeight: "23px",
              color: tone === "danger" ? email.danger : email.warning,
              textAlign: startAlign(dir),
            }}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailFooter({
  dir,
  lines,
}: {
  dir: EmailDirection;
  lines: string[];
}) {
  return (
    <table
      role="presentation"
      width={EMAIL_WIDTH}
      cellPadding={0}
      cellSpacing={0}
      border={0}
      dir={dir}
      style={{
        width: "100%",
        maxWidth: `${EMAIL_WIDTH}px`,
        borderCollapse: "collapse",
      }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{ padding: "18px 12px 4px", textAlign: "center" }}
          >
            {lines.map((line) => (
              <div
                key={line}
                style={{
                  ...baseText,
                  fontSize: "12px",
                  lineHeight: "20px",
                  color: email.muted2,
                  textAlign: "center",
                }}
              >
                {line}
              </div>
            ))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

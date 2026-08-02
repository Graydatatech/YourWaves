/**
 * The email palette.
 *
 * §3 of CLAUDE.md forbids hardcoded hex in components, because the site's
 * colours live as CSS custom properties in globals.css. Email is the one place
 * that rule cannot hold: `var()` is unsupported by Outlook's Word rendering
 * engine and unreliable in several Gmail clients, and there is no stylesheet to
 * resolve it against anyway — every colour must be a literal, inline, on the
 * element.
 *
 * So these are DUPLICATES of the tokens, deliberately, in the one file that is
 * allowed to hold them. If a brand colour changes in globals.css it must be
 * changed here too; nothing enforces that automatically.
 */
export const email = {
  /** --ink */
  ink: "#0b2a3d",
  /** --ink-deep */
  inkDeep: "#04141f",
  /**
   * --muted / --muted-2 / --accent-strong, re-solved in phase 10.
   *
   * The site's ramp was darkened because most of its text sits on the page
   * gradient rather than on white. That reasoning applies here for a different
   * reason: an email's text does not sit on white either. It sits on `page`
   * (#eef5f9) and `panel` (#f3f9fc), and inside the alert boxes on `dangerBg`
   * and `warningBg` — and against those, the old values failed:
   *
   *      old muted2 #587488   4.47:1 on page,  4.30:1 on dangerBg
   *      old accentStrong     4.57:1 on page,  4.40:1 on dangerBg
   *
   * The new values clear 4.5:1 on all five email surfaces. Keeping them equal
   * to the site tokens is also what stops a confirmation email from looking
   * like it came from a slightly different brand than the page that produced
   * it — which is exactly the sort of thing that gets a payment email reported
   * as phishing.
   */
  muted: "#425a6b",
  /** --muted-2 */
  muted2: "#4c6475",
  /** --accent. Fills and rules only — 3.84:1 on white, never for text. */
  accent: "#0b8fa3",
  /** --accent-strong, the AA-safe one for small text */
  accentStrong: "#097182",
  /** --accent-light */
  accentLight: "#7ff2ea",
  /** --surface */
  surface: "#ffffff",
  /** --footer */
  footer: "#04202f",
  /** Page background behind the 600px column. */
  page: "#eef5f9",
  /** A flat tint standing in for the frosted panels on the site. */
  panel: "#f3f9fc",
  /** --border, flattened: rgba is unreliable in Outlook. */
  border: "#dde7ee",

  /**
   * --brand-gradient, and the solid Outlook falls back to.
   *
   * Word ignores background-image entirely, so the solid must be set as
   * background-color on the SAME element and the gradient layered over it.
   * Anything that understands the image wins; Outlook keeps the solid.
   */
  brandSolid: "#22c3d4",
  brandGradient: "linear-gradient(135deg, #22e0d6 0%, #34c8ff 100%)",

  /** WhatsApp green, for the deep-link button. */
  whatsapp: "#25D366",

  danger: "#b3261e",
  dangerBg: "#fdeceb",
  warning: "#92400e",
  warningBg: "#fff7ed",
} as const;

/** 600px is the width every desktop client renders without a horizontal cut. */
export const EMAIL_WIDTH = 600;

export const font = {
  /**
   * A system stack, not the site's webfonts: @font-face is stripped by Gmail
   * and Outlook, so a webfont costs a request and then falls back anyway.
   * Arabic resolves to the platform's own Arabic face, which is what those
   * users already read everything else in.
   */
  stack:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans Arabic', 'Geeza Pro', sans-serif",
} as const;

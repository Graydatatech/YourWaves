import { Sora, Manrope, IBM_Plex_Sans_Arabic } from "next/font/google";

/**
 * All three faces are self-hosted by `next/font` at build time — no request
 * ever leaves for fonts.googleapis.com.
 *
 * `preload: false` on every face is deliberate and load-bearing.
 *
 * next/font defaults to `preload: true`, which emits a <link rel="preload">
 * for every declared face on every route. Because all three families are
 * applied as CSS variables on <html>, that meant an English page preloaded the
 * Arabic family too: measured at 244KB of fonts against an 11KB hero image on
 * the Lighthouse mobile 4G profile, pushing LCP to 4.4s. The fonts were
 * starving the LCP image of bandwidth.
 *
 * With preloading off, a face is fetched only once the CSS cascade actually
 * resolves an element to it — so an Arabic page never pulls Sora or Manrope,
 * and vice versa. `display: "swap"` means text still paints immediately in the
 * metric-matched fallback, so switching this off costs no visible text delay;
 * it only stops fonts from competing with the hero image.
 *
 * PHASE 10 revisited this and deliberately left it off. The obvious refinement
 * — preload only the face that paints above the fold for the active locale —
 * is not expressible here: `preload` is per-FAMILY, and all three families are
 * declared in this module for every route because the locale is not known
 * until `[locale]/layout.tsx` renders. Emitting the <link> by hand in that
 * layout would be possible, but it would trade a MEASURED win for an
 * unmeasured guess, and the preloaded face would still be competing with the
 * LCP image for the same 4G bandwidth. `display: "swap"` plus next/font's
 * metric-matched fallback already closes the invisible-text window that
 * preloading exists to close. Do not switch it on without a before/after trace.
 *
 * Role mapping lives in globals.css (`--font-body` / `--font-display`):
 *   en → Manrope body, Sora display
 *   ar → IBM Plex Sans Arabic for both
 *
 * WEIGHTS ARE DECLARED FROM A CENSUS, NOT FROM HABIT.
 *
 * next/font emits one file per weight per subset, and a declared weight is
 * downloaded whether or not anything resolves to it. Phase 10 counted the
 * weight utilities actually present in src/ — 400 (the body default), 600
 * (`font-semibold`, 98 uses), 700 (`font-bold`, 143) and 800 (`font-extrabold`,
 * 30 plus the two hardcoded in .text-display/.text-h2) — and cross-referenced
 * them against which family each one lands on:
 *
 *   Sora is only ever reached through --font-display, i.e. h1-h4, .text-display,
 *   .text-h2 and the .font-display utility. Every one of those uses 700 or 800.
 *   `font-semibold` never lands on a heading, so SORA 600 WAS DEAD WEIGHT — one
 *   file downloaded on every English page and resolved by nothing.
 *
 *   IBM Plex Sans Arabic carries both roles in Arabic, so it needs 400/600/700.
 *   There is no `font-medium` anywhere in the project, so 500 WAS DEAD WEIGHT
 *   TOO — and being the default locale, that file was on the critical path of
 *   the page most visitors see, twice over (arabic + latin subsets).
 *
 * Adding a weight here is fine; adding one that nothing uses is not. Re-run the
 * census before you do:  grep -rhoE '\bfont-(normal|medium|semibold|bold|extrabold)\b' src | sort | uniq -c
 */

const sora = Sora({
  subsets: ["latin"],
  // 600 removed: nothing resolving to --font-display asks for it.
  weight: ["700", "800"],
  variable: "--font-sora",
  display: "swap",
  preload: false,
});

const manrope = Manrope({
  subsets: ["latin"],
  // All three are live: 400 is the body default, 600 is font-semibold,
  // 700 is font-bold.
  weight: ["400", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
});

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  // 500 removed: no `font-medium` in the project. 800 is deliberately NOT
  // added — this family tops out at 700, so `font-extrabold` synthesises from
  // it, which is what the design already ships.
  weight: ["400", "600", "700"],
  variable: "--font-ibm-plex-arabic",
  display: "swap",
  preload: false,
});

export const fontVariables = [
  sora.variable,
  manrope.variable,
  ibmPlexSansArabic.variable,
].join(" ");

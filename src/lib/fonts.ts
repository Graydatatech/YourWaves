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
 * Role mapping lives in globals.css (`--font-body` / `--font-display`):
 *   en → Manrope body, Sora display
 *   ar → IBM Plex Sans Arabic for both
 */

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
  preload: false,
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
});

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-arabic",
  display: "swap",
  preload: false,
});

export const fontVariables = [
  sora.variable,
  manrope.variable,
  ibmPlexSansArabic.variable,
].join(" ");

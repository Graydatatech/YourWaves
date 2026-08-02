import type { Metadata } from "next";
import { routing, type Locale } from "@/i18n/routing";

/**
 * Everything that needs to know the site's public identity.
 *
 * One module, because canonical URLs, hreflang alternates, the sitemap, robots
 * and the JSON-LD all have to agree about the origin and about which paths
 * exist. Two of them disagreeing is not a visible bug — it is a slow leak of
 * duplicate-content signals that only shows up as ranking that never arrives.
 */

/**
 * Canonical origin, no trailing slash.
 *
 * Falls back to localhost so `next build` works without the variable set, which
 * matters because the marketing pages are statically generated at build time
 * and would otherwise fail a deploy preview. A production deploy MUST set
 * NEXT_PUBLIC_SITE_URL: every absolute URL below is wrong without it, and a
 * canonical tag pointing at localhost is worse than no canonical tag at all.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** True once the site has a real origin — guards robots/sitemap output. */
export function hasCanonicalOrigin(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SITE_URL === "string" &&
    process.env.NEXT_PUBLIC_SITE_URL.trim() !== ""
  );
}

/**
 * Absolute URL for a locale-prefixed path.
 * `path` is the part AFTER the locale segment: "" for the home page,
 * "/booking/success/YW-2026-0001" for a deep page.
 */
export function localeUrl(locale: Locale, path = ""): string {
  const suffix = path === "/" ? "" : path;
  return `${SITE_URL}/${locale}${suffix}`;
}

/**
 * `alternates` for a page that exists in every locale.
 *
 * Two things worth not getting wrong:
 *
 *  - The canonical is the URL of THIS locale, not of the default one. Pointing
 *    /en at /ar tells Google the English page is a duplicate that should not be
 *    indexed, which is the opposite of what a bilingual site wants.
 *  - `x-default` names the version to serve a user whose language we do not
 *    match. That is the Arabic page here, because it is the default locale and
 *    the business is in Qatar — NOT the English one, which is the reflex.
 *
 * Next.js resolves these against `metadataBase`, but they are written absolute
 * anyway: an hreflang cluster has to be absolute to be valid, and relying on a
 * base that a future refactor might not set is a silent failure.
 */
export function alternatesFor(locale: Locale, path = ""): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const other of routing.locales) {
    languages[other] = localeUrl(other, path);
  }
  languages["x-default"] = localeUrl(routing.defaultLocale, path);

  return {
    canonical: localeUrl(locale, path),
    languages,
  };
}

/**
 * The OpenGraph `locale` / `alternateLocale` pair.
 *
 * OpenGraph wants language_TERRITORY, not a bare language code — Facebook and
 * WhatsApp both ignore `ar` and honour `ar_QA`. WhatsApp link previews are how
 * a large share of this site's traffic will actually arrive, so this is not
 * pedantry.
 */
const OG_LOCALES: Record<Locale, string> = {
  ar: "ar_QA",
  en: "en_QA",
};

export function ogLocales(locale: Locale): {
  locale: string;
  alternateLocale: string[];
} {
  return {
    locale: OG_LOCALES[locale],
    alternateLocale: routing.locales
      .filter((other) => other !== locale)
      .map((other) => OG_LOCALES[other]),
  };
}

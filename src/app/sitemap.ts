import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { localeUrl } from "@/lib/seo";

/**
 * /sitemap.xml
 *
 * Lives at the app ROOT, not inside `[locale]` — a sitemap is one document for
 * the whole site, and putting it under the locale segment would produce
 * /ar/sitemap.xml and /en/sitemap.xml, neither of which is where a crawler
 * looks.
 *
 * Every entry carries its own `alternates.languages`, which is the sitemap
 * form of the hreflang cluster in the <head>. Declaring it in both places is
 * not redundant: Google reads whichever it finds first, and a page that is
 * discovered through the sitemap may be scheduled for crawl before its HTML has
 * ever been fetched.
 *
 * Only pages that should be INDEXED belong here. That is a much shorter list
 * than "pages that exist":
 *
 *   /[locale]                      the marketing page — the whole public site
 *
 * and deliberately not:
 *   /[locale]/booking/success/…    per-booking, reachable only with a reference
 *   /[locale]/booking/failed/…     same
 *   /admin/*                       noindex, and gated
 *   /d/*                           a capability URL; indexing one would publish
 *                                  a customer's home address
 *   /dev/*                         404s in production
 *   /[locale]/styleguide           404s in production
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    routing.locales.map((locale) => [locale, localeUrl(locale, "")]),
  );

  return routing.locales.map((locale) => ({
    url: localeUrl(locale, ""),
    // A fixed date rather than `new Date()`. `lastModified` is meant to say
    // "the content changed"; wiring it to build time tells a crawler the page
    // changed every time anything in the repository did, which trains it to
    // stop believing the field. Update this when the copy actually changes.
    lastModified: new Date("2026-08-02"),
    changeFrequency: "monthly",
    // Both locales are equal citizens. Arabic is the default, but demoting the
    // English page here would suppress it for exactly the audience that
    // searches in English.
    priority: 1,
    alternates: {
      languages: {
        ...languages,
        "x-default": localeUrl(routing.defaultLocale, ""),
      },
    },
  }));
}

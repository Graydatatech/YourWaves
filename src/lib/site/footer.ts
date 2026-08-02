import "server-only";

import { sql } from "@/db/client";
import type { Locale } from "@/i18n/routing";

/**
 * Footer content, with the designed copy as the floor.
 *
 * The back office can override any field; anything it has not set — or has
 * cleared — falls back to `messages/*.json`. That is what makes an untouched
 * deployment render the designed footer instead of blanks, and what makes
 * emptying a box in the settings screen RESTORE the default rather than delete
 * the line. "Clear it to reset" is the behaviour a non-technical person
 * expects, and the alternative is a page with a hole in it.
 *
 * Reads one row. The caller decides how long to cache it — see the note on
 * revalidation where SiteFooter is rendered.
 */

export type FooterView = {
  tagline: string;
  email: string;
  phone: string;
  cities: string;
  /** Empty means the link is not rendered at all. */
  instagram: string;
  whatsapp: string;
  youtube: string;
};

/** The catalogue strings, passed in by the component that has the translator. */
export type FooterDefaults = {
  tagline: string;
  email: string;
  phone: string;
  cities: string;
};

function pick(override: unknown, fallback: string): string {
  return typeof override === "string" && override.trim() !== ""
    ? override.trim()
    : fallback;
}

/**
 * A social URL, or "" to hide the link.
 *
 * `instagram.com/yourwaves` typed without a scheme becomes an href the browser
 * resolves RELATIVE to the current page — a link to a 404 on our own domain,
 * which looks like a broken site rather than a mistyped setting. Prefixing
 * https:// is the fix, and it is done here rather than in the form so a value
 * saved before this existed is also repaired on read.
 */
function toUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Refuse anything that looks like another scheme — javascript:, data: — by
  // only ever prefixing, never passing an unrecognised scheme through.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "";
  return `https://${trimmed}`;
}

export async function getFooter(
  locale: Locale,
  defaults: FooterDefaults,
): Promise<FooterView> {
  let overrides: Record<string, unknown> = {};

  try {
    const rows = await sql<{ footer: Record<string, unknown> | null }[]>`
      SELECT footer FROM settings WHERE id = 1
    `;
    overrides = rows[0]?.footer ?? {};
  } catch {
    // A database that has not run migration 0015 yet, or is briefly
    // unreachable, must not take the footer off every page. The designed copy
    // is a perfectly good answer.
    overrides = {};
  }

  const isArabic = locale === "ar";

  return {
    tagline: pick(
      isArabic ? overrides.taglineAr : overrides.taglineEn,
      defaults.tagline,
    ),
    email: pick(overrides.email, defaults.email),
    phone: pick(overrides.phone, defaults.phone),
    cities: pick(
      isArabic ? overrides.citiesAr : overrides.citiesEn,
      defaults.cities,
    ),
    instagram: toUrl(overrides.instagram),
    whatsapp: toUrl(overrides.whatsapp),
    youtube: toUrl(overrides.youtube),
  };
}

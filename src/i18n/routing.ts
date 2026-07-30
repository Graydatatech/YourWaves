import { defineRouting } from "next-intl/routing";

/**
 * Single source of truth for locales.
 * `ar` is the default locale: `/` redirects to `/ar` and renders dir="rtl".
 */
export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  // Always prefix so the active locale is unambiguous in the URL.
  localePrefix: "always",
  // We resolve the locale from the URL only; no cookie/header sniffing, so a
  // shared link always renders the language it says it does.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const localeDirections: Record<Locale, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
};

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

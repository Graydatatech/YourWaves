import type { routing } from "@/i18n/routing";
import type messages from "../messages/en.json";

/**
 * Makes `useTranslations()` keys and the `Locale` type check against the real
 * message catalogue, so a typo in a message key is a build error.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}

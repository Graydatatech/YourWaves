import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";

/**
 * The back office is English-only, on purpose — but wired through next-intl
 * rather than hardcoded, so it does not have to be rewritten to change that.
 *
 * Strings live in the `admin` namespace of the normal catalogue. Making it
 * bilingual later is two steps and no refactor:
 *
 *   1. add the `admin` namespace to messages/ar.json;
 *   2. replace ADMIN_LOCALE below with the locale from the session or the URL.
 *
 * `admin` is deliberately NOT in CLIENT_NAMESPACES: the marketing site's layout
 * decides what ships to a customer's browser, and none of this belongs there.
 * The admin layout provides it to its own subtree instead.
 */

export const ADMIN_LOCALE = "en" as const;

export const adminMessages = { admin: en.admin };

/** For Server Components and route handlers, which have no React context. */
export function adminT() {
  return createTranslator({
    locale: ADMIN_LOCALE,
    messages: en,
    namespace: "admin",
  });
}

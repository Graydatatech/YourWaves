import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
import en from "../../messages/en.json";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    /**
     * The `admin` namespace is merged in for EVERY locale, always in English.
     *
     * /admin sits outside the [locale] segment, so this config resolves it to
     * the default locale (`ar`) and a Server Component there would throw
     * MISSING_MESSAGE — which is exactly what happened when a shared admin
     * component was missing its "use client". The components are fixed, but
     * this makes the next omission render correctly instead of crashing a
     * page.
     *
     * It costs the customer site nothing: Server Components do not ship their
     * messages, and `admin` is deliberately absent from CLIENT_NAMESPACES, so
     * none of it reaches a customer's browser.
     */
    messages: { ...messages, admin: en.admin },
  };
});

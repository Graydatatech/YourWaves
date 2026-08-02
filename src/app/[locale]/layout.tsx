import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { routing, isLocale, localeDirections } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = {
  // Resolves every relative URL in a metadata object — OG images, canonicals,
  // hreflang. Falls back to localhost so a build without the variable still
  // succeeds; lib/seo.ts is the single place that fallback is defined.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "YourWaves",
    template: "%s · YourWaves",
  },
  description: "Full-day mobile flowrider rental, delivered to your villa.",
  /**
   * Noindex by DEFAULT, and the marketing page is the only thing under
   * [locale] that opts back in.
   *
   * Written this way round on purpose. The booking success and failure pages
   * are keyed by booking reference and name a real customer's order; the
   * styleguide is an internal reference. Neither should ever be indexed, and
   * relying on each of them to remember to say so is how one of them ends up
   * in a search result. Inverting the default means a NEW page under [locale]
   * is private until somebody deliberately publishes it.
   */
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // No maximum-scale / user-scalable=no: pinch zoom must stay available.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#22e0d6",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Namespaces that Client Components read. Keep this list tight — anything
 * added here is shipped to every visitor's browser. If a `useTranslations`
 * call in a Client Component starts returning the raw key, its namespace is
 * probably missing from this list.
 */
const CLIENT_NAMESPACES = [
  "common",
  "nav",
  "testimonials",
  // The whole booking flow is client-side (wizard state, live availability), so
  // it needs its namespace shipped. Without this every label in the booking
  // section renders as its raw key, e.g. "booking.steps.dateTitle".
  "booking",
] as const;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  // `params` is a Promise in Next.js 16 — synchronous access was removed.
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  // Opts this segment into static rendering for the given locale.
  setRequestLocale(locale);

  // NextIntlClientProvider forwards the WHOLE catalogue to the browser by
  // default, which inlines every FAQ answer and spec value into the RSC
  // payload even though they are rendered on the server. Only these three
  // namespaces are read by Client Components (SiteHeader/LocaleSwitcher →
  // nav+common, Testimonials → testimonials), so only these are sent.
  const allMessages = await getMessages();
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in allMessages).map((ns) => [
      ns,
      allMessages[ns],
    ]),
  );

  return (
    <html
      lang={locale}
      dir={localeDirections[locale]}
      // Restores the pre-16 behaviour of neutralising smooth scrolling during
      // route transitions, so navigations still feel instant.
      data-scroll-behavior="smooth"
      className={fontVariables}
    >
      <body className="text-ink min-h-dvh font-sans antialiased">
        <NextIntlClientProvider messages={clientMessages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { alternatesFor, localeUrl, ogLocales } from "@/lib/seo";
import { buildJsonLd, FAQ_ITEMS } from "@/lib/jsonLd";
import {
  BookingSection,
  Faq,
  Gallery,
  Hero,
  HowItWorks,
  SafetySpecs,
  SiteFooter,
  SiteHeader,
} from "@/components/marketing";

/**
 * ISR, not fully static, and this is the cost of an editable footer.
 *
 * SiteFooter reads the settings row. A database read is not one of Next's
 * dynamic APIs, so without this the query would run at BUILD time and the
 * result would be baked in — an admin editing the footer would see nothing
 * change until the next deploy, which is not what an editable field means.
 *
 * 300s keeps the page cached and fast (phase 10's whole point) while making a
 * footer edit appear within five minutes. Do not swap this for
 * `force-dynamic`: that would put a database round trip in front of every
 * visitor on the 4G budget, to keep a line of copy fresh to the second.
 */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: "hero" });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  const title = `${tCommon("brand")} — ${t("title")}`;
  const description = t("subtitle");

  return {
    title,
    description,
    /**
     * The hreflang cluster and the canonical, from the one helper that also
     * feeds the sitemap. See lib/seo.ts for why x-default is the ARABIC page.
     */
    alternates: alternatesFor(locale, ""),
    openGraph: {
      title,
      description,
      url: localeUrl(locale, ""),
      siteName: tCommon("brand"),
      type: "website",
      ...ogLocales(locale),
      /**
       * No `images` here on purpose. The co-located `opengraph-image.tsx`
       * supplies it, and Next merges that in automatically with the right
       * absolute URL, dimensions and alt text. Setting it here as well would
       * emit two og:image tags, and a scraper takes the first — which would be
       * this one, silently overriding the generated card.
       */
    },
    twitter: {
      // `summary_large_image` is the only card worth using for a visual
      // product; `summary` crops the 1200x630 to a small square and loses the
      // wordmark entirely.
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        // Let Google show a full-size image and a long snippet — this page is
        // the whole public site and there is nothing to hold back.
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("common");
  const tHero = await getTranslations("hero");
  const tFooter = await getTranslations("footer");
  const tFaq = await getTranslations("faq");

  /**
   * Structured data, built from the same catalogue the page renders below.
   *
   * Injected with `dangerouslySetInnerHTML` because that is the only way to
   * emit a raw <script> body in React — the content is our own translated copy
   * and a JSON.stringify of an object we constructed, not user input. The `<`
   * escape guards the one case that is still a real injection vector: a
   * translated string containing `</script>` would otherwise close the tag
   * early and let the rest of the string be parsed as HTML.
   */
  const jsonLd = buildJsonLd({
    locale,
    brand: t("brand"),
    tagline: t("tagline"),
    heroTitle: tHero("title"),
    heroSubtitle: tHero("subtitle"),
    email: tFooter("email"),
    phone: tFooter("phone"),
    faq: FAQ_ITEMS.map((item) => ({
      question: tFaq(`items.${item}.question`),
      answer: tFaq(`items.${item}.answer`),
    })),
    imageUrl: `${localeUrl(locale, "")}/opengraph-image`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      {/* First focusable element on the page: lets keyboard and screen-reader
          users jump past the sticky header. */}
      <a
        href="#main"
        className={[
          "sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100]",
          "focus:bg-surface focus:text-ink focus:shadow-card focus:rounded-pill",
          "focus:px-5 focus:py-3 focus:font-semibold",
        ].join(" ")}
      >
        {t("skipToContent")}
      </a>

      <SiteHeader />

      <main id="main">
        <Hero />
        <HowItWorks />
        <SafetySpecs />
        <Gallery />
        <BookingSection />
        <Faq />
      </main>

      <SiteFooter />
    </>
  );
}

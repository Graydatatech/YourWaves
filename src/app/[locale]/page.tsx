import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: "hero" });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  return {
    title: `${tCommon("brand")} — ${t("title")}`,
    description: t("subtitle"),
    openGraph: {
      title: tCommon("brand"),
      description: t("subtitle"),
      images: ["/media/hero-poster.jpg"],
      locale,
      type: "website",
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

  return (
    <>
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

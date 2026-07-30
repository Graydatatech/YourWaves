import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { BookingResult } from "@/components/booking/BookingResult";
import { SiteFooter, SiteHeader } from "@/components/marketing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}): Promise<Metadata> {
  const { locale, reference } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "booking.result" });
  return {
    title: `${t("confirmedTitle")} — ${reference}`,
    // A booking reference must never be indexed.
    robots: { index: false, follow: false },
  };
}

/**
 * /[locale]/booking/success/[reference]
 *
 * A thin server shell. The interactive part is BookingResult, which polls until
 * the webhook has settled — this page renders nothing implying the payment
 * succeeded, because reaching this URL proves only that a browser navigated here.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  // From the message catalogue, so the number is not hardcoded in client JS.
  const tFooter = await getTranslations({ locale, namespace: "footer" });

  return (
    <>
      <SiteHeader />
      <main className="shell wide:py-16 py-10">
        <div className="mx-auto w-full max-w-lg">
          <BookingResult
            reference={reference}
            locale={locale}
            intent="success"
            whatsappNumber={tFooter("phone")}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

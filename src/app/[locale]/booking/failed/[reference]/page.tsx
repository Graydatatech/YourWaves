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
    title: `${t("failedTitle")} — ${reference}`,
    robots: { index: false, follow: false },
  };
}

/**
 * /[locale]/booking/failed/[reference]
 *
 * Shown when the provider reports a decline or the customer cancels. The hold is
 * deliberately still alive here — `settle_payment_failure` leaves the booking
 * 'holding' until its natural expiry — so "try again" returns to a flow with the
 * same date still reserved rather than an empty form.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const tFooter = await getTranslations({ locale, namespace: "footer" });

  return (
    <>
      <SiteHeader />
      <main className="shell wide:py-16 py-10">
        <div className="mx-auto w-full max-w-lg">
          <BookingResult
            reference={reference}
            locale={locale}
            intent="failed"
            whatsappNumber={tFooter("phone")}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

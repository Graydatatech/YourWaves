import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { isLocale, routing } from "@/i18n/routing";
import { StyleguidePanel } from "./StyleguidePanel";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Development-only design system reference. Both locales render side by side
 * (stacked on mobile) so RTL and LTR can be compared at a glance.
 *
 * Guarded rather than deleted from the build: in production this route 404s.
 */
export default async function StyleguidePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <StyleguidePanel locale="ar" />
        <StyleguidePanel locale="en" />
      </div>
    </main>
  );
}

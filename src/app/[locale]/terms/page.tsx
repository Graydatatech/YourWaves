import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { alternatesFor } from "@/lib/seo";
import { getTerms } from "@/lib/booking/terms";

/**
 * Reads the live settings row, so an edit in the back office is visible on the
 * next request rather than the next deploy. That rules out static generation —
 * terms that are a deploy behind are the wrong terms.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: "terms" });

  return {
    title: t("title"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/terms"),
    /**
     * Indexable, unlike the rest of [locale] which defaults to noindex. A
     * published terms page is something a payment gateway's onboarding review
     * looks for — docs/payments-setup.md notes that a missing refund policy is
     * a common cause of a rejected merchant application.
     */
    robots: { index: true, follow: true },
  };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("terms");
  const { paragraphs, isFallback } = await getTerms(locale);

  return (
    <main className="section-y">
      <div className="section-x mx-auto w-full max-w-[820px]">
        <h1 className="text-h2 text-ink">{t("title")}</h1>

        {paragraphs.length === 0 ? (
          // Not a 404: the page is real and linked from the booking form, it
          // just has nothing in it yet. Saying so is more useful than pretending
          // the URL is wrong.
          <p className="text-muted text-body mt-6">{t("empty")}</p>
        ) : (
          <>
            {isFallback && (
              // The Arabic reader is getting English. Say so rather than let
              // them wonder whether the page is broken.
              <p
                lang="en"
                dir="ltr"
                className="rounded-input border-border text-muted-2 mt-6 border p-3 text-sm"
              >
                {t("englishOnly")}
              </p>
            )}

            <div className="mt-8 flex flex-col gap-4">
              {paragraphs.map((paragraph, index) => (
                // Plain text, rendered as text. There is no
                // dangerouslySetInnerHTML here and there must never be: an
                // admin can edit this, and a public page is not somewhere they
                // should be able to put script. `whitespace-pre-line` keeps
                // single line breaks inside a paragraph, which is how a list
                // typed into a textarea survives.
                <p
                  key={index}
                  className="text-muted text-body whitespace-pre-line"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </>
        )}

        <Link
          href="/"
          className="text-accent-strong mt-10 inline-flex min-h-11 items-center font-bold underline"
        >
          {t("back")}
        </Link>
      </div>
    </main>
  );
}

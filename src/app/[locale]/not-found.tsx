import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * 404 for anything inside a `[locale]` segment.
 *
 * The root `app/not-found.tsx` still exists and still matters — it catches URLs
 * that never resolved a locale at all, where there is no catalogue to read. But
 * a customer who mistypes a path under /ar or /en has a locale, and telling
 * them in the wrong language is a worse experience than the generic page.
 *
 * No document shell here: this renders INSIDE `[locale]/layout.tsx`, so it
 * already has <html lang dir>, the fonts and the intl provider. That is the
 * whole reason it can be translated at all.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-16">
      <div className="rounded-card border-border bg-surface shadow-card w-full max-w-md border p-7 text-center">
        <p className="text-accent-strong text-xs font-bold tracking-[0.18em]">
          {t("code")}
        </p>
        <h1 className="text-ink mt-3 text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted mt-2 text-base">{t("body")}</p>
        <Link
          href="/"
          className="tap-target rounded-pill bg-brand text-ink-deep shadow-cta mt-6 inline-flex items-center justify-center px-6 font-bold"
        >
          {t("back")}
        </Link>
      </div>
    </main>
  );
}

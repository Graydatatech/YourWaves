import Link from "next/link";
import { routing } from "@/i18n/routing";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

/**
 * 404 for requests that never reached a `[locale]` segment.
 *
 * There is a locale-aware sibling at `[locale]/not-found.tsx` which handles the
 * ordinary case — a mistyped path under /ar or /en, where the catalogue is
 * available and the copy can be translated properly. This one is for URLs that
 * resolved no locale at all: `/nonsense`, a stale link from before the locale
 * prefix existed, or a request under /admin or /d that fell through.
 *
 * It renders its own document shell because the root layout is a pass-through
 * (see app/layout.tsx: `lang` and `dir` depend on a locale this page does not
 * have). It also carries `fontVariables`, which the previous version did not —
 * without it `--font-body` resolves to nothing and the page renders in the
 * browser's default serif, which looks like a different site's error page.
 *
 * BILINGUAL, where it used to be Arabic-only. The old reasoning was that Arabic
 * is the default locale, but that does not survive contact with who lands here:
 * the visitor followed a link that does not work, so we know nothing about them
 * — not even the language preference a working URL would have carried. Both,
 * each half carrying its own `lang`/`dir` so a screen reader switches
 * pronunciation between them (WCAG 3.1.2), and two buttons, because the
 * destinations genuinely differ.
 */
export default function NotFound() {
  const defaultIsArabic = routing.defaultLocale === "ar";
  const primary = defaultIsArabic ? "ar" : "en";
  const secondary = defaultIsArabic ? "en" : "ar";

  const HOME = {
    ar: { label: "العودة إلى الرئيسية", dir: "rtl" as const },
    en: { label: "Back to home", dir: "ltr" as const },
  };

  return (
    <html lang="ar" dir="rtl" className={fontVariables}>
      <body className="text-ink bg-page min-h-dvh font-sans antialiased">
        <main className="grid min-h-dvh place-items-center px-5 py-16">
          <div className="rounded-card border-border bg-surface shadow-card w-full max-w-md border p-7">
            <p className="text-accent-strong text-center text-xs font-bold tracking-[0.18em]">
              404
            </p>

            <div lang="ar" dir="rtl" className="mt-3 text-center">
              <h1 className="text-ink text-xl font-bold">الصفحة غير موجودة</h1>
              <p className="text-muted mt-2 text-base">
                الصفحة التي تبحث عنها غير متوفرة.
              </p>
            </div>

            <div
              lang="en"
              dir="ltr"
              className="border-border mt-6 border-t pt-6 text-center"
            >
              <h2 className="text-ink text-xl font-bold">Page not found</h2>
              <p className="text-muted mt-2 text-base">
                The page you are looking for does not exist.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href={`/${primary}`}
                lang={primary}
                dir={HOME[primary].dir}
                className="tap-target rounded-pill bg-brand text-ink-deep shadow-cta inline-flex items-center justify-center px-6 font-bold"
              >
                {HOME[primary].label}
              </Link>
              <Link
                href={`/${secondary}`}
                lang={secondary}
                dir={HOME[secondary].dir}
                className="tap-target border-border text-ink rounded-pill hover:bg-ink/5 inline-flex items-center justify-center border px-6 font-bold transition-colors"
              >
                {HOME[secondary].label}
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

"use client";

import { useEffect } from "react";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

/**
 * The last resort: an error thrown by a ROOT layout, before any locale segment
 * has rendered.
 *
 * Two consequences follow from that, and both drive the shape of this file.
 *
 * First, it replaces the entire document, so it has to render its own <html>
 * and <body> — the layout that would normally supply them is the thing that
 * failed.
 *
 * Second, there is no locale. Not "the default locale" — genuinely none: this
 * boundary catches failures from before routing resolved, and it also covers
 * /admin and /d, which have no locale segment at all. Guessing Arabic would
 * leave an English-speaking driver staring at a message they cannot read, and
 * guessing English would do the same to the majority of customers. So it says
 * it in both, Arabic first because that is the default locale, each half
 * carrying its own `lang` and `dir` so a screen reader switches voice between
 * them instead of reading Arabic with an English pronunciation model.
 *
 * The document itself is `lang="ar" dir="rtl"` because a document needs one
 * primary language and Arabic is it; the English block overrides both locally,
 * which is precisely what WCAG 3.1.2 (Language of Parts) is for.
 */

const COPY = [
  {
    lang: "ar",
    dir: "rtl" as const,
    title: "حدث خطأ ما",
    body: "تعذّر تحميل الصفحة. حاول مرة أخرى.",
    retry: "إعادة المحاولة",
  },
  {
    lang: "en",
    dir: "ltr" as const,
    title: "Something went wrong",
    body: "This page could not be loaded. Please try again.",
    retry: "Try again",
  },
];

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[yourwaves] global error", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="ar" dir="rtl" className={fontVariables}>
      <body className="text-ink bg-page min-h-dvh font-sans antialiased">
        <main className="grid min-h-dvh place-items-center px-5 py-16">
          <div className="rounded-card border-border bg-surface shadow-card w-full max-w-md border p-7">
            {COPY.map((copy, index) => (
              <div
                key={copy.lang}
                lang={copy.lang}
                dir={copy.dir}
                className={
                  index === 0
                    ? "text-center"
                    : "border-border mt-6 border-t pt-6 text-center"
                }
              >
                <h1 className="text-ink text-xl font-bold">{copy.title}</h1>
                <p className="text-muted mt-2 text-base">{copy.body}</p>
              </div>
            ))}

            <button
              type="button"
              onClick={reset}
              className="tap-target rounded-pill bg-brand text-ink-deep shadow-cta mt-6 inline-flex w-full items-center justify-center px-6 font-bold"
            >
              {/* One button, labelled in both languages — two buttons doing the
                  identical thing would be a worse choice than a bilingual one. */}
              <span lang="ar">{COPY[0].retry}</span>
              <span aria-hidden="true" className="text-ink-deep/40 mx-2">
                ·
              </span>
              <span lang="en">{COPY[1].retry}</span>
            </button>

            {error.digest && (
              <p className="text-muted-3 mt-5 text-center text-xs">
                <span dir="ltr" className="font-mono">
                  {error.digest}
                </span>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}

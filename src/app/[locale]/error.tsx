"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

/**
 * The 500 for anything rendered inside a locale segment.
 *
 * COPY IS INLINE, NOT IN THE CATALOGUE, and that is deliberate rather than
 * lazy. An error boundary has to work in exactly the situation where the rest
 * of the app did not, and `messages/*.json` is part of the rest of the app: a
 * malformed catalogue, a missing namespace or a failed dynamic import of the
 * locale file all render this component, and a version of it that called
 * `useTranslations` would throw MISSING_MESSAGE on top of the original error —
 * turning a recoverable page into a blank one. It also keeps the `notFound`/
 * `error` strings out of CLIENT_NAMESPACES, which every visitor pays for.
 *
 * `useLocale()` is safe by contrast: next-intl always provides the locale, it
 * is a single string rather than a catalogue lookup, and if the provider is
 * missing the `?? "ar"` covers it.
 */

const COPY = {
  ar: {
    title: "حدث خطأ ما",
    body: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى، وإن استمرت المشكلة تواصل معنا.",
    retry: "إعادة المحاولة",
    home: "العودة إلى الرئيسية",
    reference: "رقم الخطأ",
  },
  en: {
    title: "Something went wrong",
    body: "This page could not be loaded. Try again, and if it keeps happening please get in touch.",
    retry: "Try again",
    home: "Back to home",
    reference: "Error reference",
  },
} as const;

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const t = COPY[locale === "en" ? "en" : "ar"];

  useEffect(() => {
    // The only thing worth doing with the error object client-side. The message
    // itself is NOT rendered: a server error's message can carry a connection
    // string or a row's contents, and this page is shown to a customer.
    console.error("[yourwaves] render error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-16">
      <div className="rounded-card border-border bg-surface shadow-card w-full max-w-md border p-7 text-center">
        <h1 className="text-ink text-2xl font-bold">{t.title}</h1>
        <p className="text-muted mt-2 text-base">{t.body}</p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={reset}
            className="tap-target rounded-pill bg-brand text-ink-deep shadow-cta inline-flex items-center justify-center px-6 font-bold"
          >
            {t.retry}
          </button>
          {/* A plain anchor, not next/link: the router is a plausible cause of
              whatever brought us here, and a full document load is the one
              navigation that cannot fail the same way. */}
          <a
            href={`/${locale}`}
            className="tap-target text-muted hover:text-ink inline-flex items-center justify-center text-base font-semibold underline"
          >
            {t.home}
          </a>
        </div>

        {/* The digest is the only handle support has for finding this in the
            server logs. Shown quietly, wrapped LTR because it is a hex string
            that must not be reordered by the Arabic around it. */}
        {error.digest && (
          <p className="text-muted-3 mt-6 text-xs">
            {t.reference}{" "}
            <span dir="ltr" className="font-mono">
              {error.digest}
            </span>
          </p>
        )}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

/**
 * The document shell for the pre-launch gate.
 *
 * Its own, because the root layout is a pass-through with no `<html>` and no
 * `globals.css` — the real shell lives under `[locale]`, and this page is
 * deliberately outside that segment so the locale rewrite cannot bounce it to
 * /ar/access before anybody has typed anything.
 *
 * `noindex` and `no-referrer`: a page that exists to keep the site out of
 * search results should not be the one thing in it that gets indexed.
 *
 * `lang="ar" dir="rtl"` matches the site's default locale. The copy is
 * bilingual — somebody arriving here has told us nothing about their language,
 * the same reasoning the locale-less 404 uses — and the English half carries
 * its own `lang`/`dir`, which is WCAG 3.1.2 doing exactly what it is for.
 */
export const metadata: Metadata = {
  title: "YourWaves",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  referrer: "no-referrer",
};

export default function AccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={fontVariables}>
      <head>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </head>
      <body className="text-ink bg-page min-h-dvh font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

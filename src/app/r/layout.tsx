import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

/**
 * The document shell for survey links.
 *
 * `noindex` and `no-referrer` for the same reason the dispatch sheet has them
 * (§4i): the URL is the credential. A referrer header would hand a working link
 * to every third party the page touches, and an indexed page would put a
 * customer's booking reference in a search engine.
 *
 * `lang`/`dir` are the document default here and overridden per-request on the
 * page, which is the only place that knows the customer's language — a layout
 * cannot read a route's data. Declaring them is not optional: an <html> with no
 * `lang` is a WCAG 3.1.1 failure, and the page-level override is 3.1.2 doing
 * exactly what it is for.
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

export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      dir="ltr"
      data-scroll-behavior="smooth"
      className={fontVariables}
    >
      <head>
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </head>
      <body className="text-ink bg-page min-h-dvh font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

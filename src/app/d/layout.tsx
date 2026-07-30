import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

/**
 * The document shell for dispatch links.
 *
 * `noindex, nofollow` and a `no-referrer` policy are not decoration here. The
 * URL *is* the credential: a referrer header would hand a working token to
 * every third party the recipient taps through to, and an indexed page would
 * put a customer's home address in a search engine.
 *
 * The title is deliberately generic — a phone's tab list and any screenshot
 * shared in a group chat must not name the customer.
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

export default function DispatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html data-scroll-behavior="smooth" className={fontVariables}>
      <head>
        {/* Belt and braces: the meta tag covers clients that ignore the header,
            and this page must never leak its own URL. */}
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        {/* A driver reads this outdoors. Locking to light keeps the contrast
            predictable rather than inheriting a dark theme that washes out. */}
        <meta name="color-scheme" content="light" />
      </head>
      {/* `lang` and `dir` are set per-request by the page, which knows the
          recipient's language. */}
      <body className="min-h-dvh bg-white text-[#04141f] antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { ADMIN_LOCALE, adminMessages } from "@/lib/admin/intl";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = {
  title: "YourWaves ops",
  robots: { index: false, follow: false },
};

/**
 * The document shell for everything under /admin.
 *
 * Deliberately contains NO authorisation. The login and MFA screens live in
 * this subtree and must render for someone who is not (yet) signed in — a gate
 * here would redirect the login page to itself. The gate is one level down, in
 * (dashboard)/layout.tsx, which wraps only the guarded routes.
 *
 * /admin sits outside the [locale] segment: it is English-only, so `dir` and
 * `lang` are fixed. See lib/admin/intl.ts for what makes that reversible.
 */
export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang={ADMIN_LOCALE}
      dir="ltr"
      data-scroll-behavior="smooth"
      className={fontVariables}
    >
      <body className="bg-page text-ink min-h-dvh antialiased">
        <NextIntlClientProvider
          locale={ADMIN_LOCALE}
          messages={adminMessages}
          timeZone="Asia/Qatar"
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

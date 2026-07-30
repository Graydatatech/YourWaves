import Link from "next/link";
import { routing } from "@/i18n/routing";
import "./globals.css";

/**
 * Global 404 for requests that never reached a `[locale]` segment (so no
 * locale context exists). Because the root layout is a pass-through, this file
 * has to render its own document shell. Copy is intentionally in the default
 * locale only.
 */
export default function NotFound() {
  return (
    <html lang={routing.defaultLocale} dir="rtl">
      <body className="text-ink font-sans antialiased">
        <main className="grid min-h-dvh place-items-center px-4">
          <div className="rounded-card border-border bg-surface shadow-card w-full max-w-sm border p-6 text-center">
            <p className="text-accent text-xs font-bold tracking-[0.18em]">
              404
            </p>
            <h1 className="text-ink mt-3 text-2xl font-bold">
              الصفحة غير موجودة
            </h1>
            <p className="text-muted mt-2 text-base">
              الصفحة التي تبحث عنها غير متوفرة.
            </p>
            <Link
              href={`/${routing.defaultLocale}`}
              className="tap-target rounded-pill bg-brand text-ink-deep shadow-cta mt-5 inline-flex items-center justify-center px-5 font-semibold"
            >
              العودة إلى الرئيسية
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}

import { fontVariables } from "@/lib/fonts";
import "../globals.css";

/**
 * Document shell for the /dev tools.
 *
 * The root layout is a pass-through with no <html> — `lang` and `dir` depend on
 * the locale, which /dev routes do not have. So these pages need their own
 * shell, and crucially their own globals.css import: without it every Tailwind
 * class is inert, which made the navigation guard measure an unstyled page and
 * report the `wide:` variant as broken.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={fontVariables}>
      <body className="bg-page text-ink min-h-dvh antialiased">{children}</body>
    </html>
  );
}

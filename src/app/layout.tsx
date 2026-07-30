import type { ReactNode } from "react";

/**
 * Pass-through root layout.
 *
 * `<html>` and `<body>` cannot live here because the `lang` and `dir`
 * attributes depend on the active locale, which is only known inside the
 * `[locale]` segment. Next.js requires a root layout to exist, so this one
 * simply forwards children; `app/[locale]/layout.tsx` renders the document
 * shell (as does `app/not-found.tsx` for locale-less 404s).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

/** Short labels for the header pill; the language's own name in its own script. */
const SHORT_LABEL: Record<string, string> = { en: "EN", ar: "ع" };

export type LocaleSwitcherProps = {
  className?: string;
  /**
   * `compact` — two-character pill for the header, where horizontal space is
   * the scarcest resource and the nav must stay on one row.
   * `full` — spelled-out language names.
   */
  variant?: "compact" | "full";
};

/**
 * Renders one anchor per locale pointing at the *current* route, so switching
 * language keeps the user on the page they were reading.
 *
 * `scroll={false}` preserves scroll position across the switch; without it the
 * App Router resets the viewport to the top.
 */
export function LocaleSwitcher({
  className,
  variant = "full",
}: LocaleSwitcherProps) {
  const activeLocale = useLocale();
  // Locale-stripped pathname, e.g. "/styleguide" while on "/ar/styleguide".
  const pathname = usePathname();
  const t = useTranslations("common");

  const isCompact = variant === "compact";

  return (
    <nav
      aria-label={t("language")}
      className={cn(
        "border-border inline-flex shrink-0 items-center rounded-full border p-0.5",
        isCompact ? "gap-0.5 bg-white/60" : "glass gap-1 p-1",
        className,
      )}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === activeLocale;
        const fullLabel =
          locale === "ar" ? t("switchToArabic") : t("switchToEnglish");

        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            scroll={false}
            hrefLang={locale}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "grid place-items-center rounded-full font-semibold transition-colors",
              isCompact ? "tap-target text-sm" : "tap-target px-4 text-sm",
              isActive
                ? "bg-brand text-ink-deep"
                : "text-muted hover:text-ink hover:bg-ink/5",
            )}
          >
            {isCompact ? (
              <>
                {/* "EN"/"ع" is a visual abbreviation; the accessible name is
                    the language's full endonym. */}
                <span aria-hidden="true">{SHORT_LABEL[locale]}</span>
                <span className="sr-only">{fullLabel}</span>
              </>
            ) : (
              fullLabel
            )}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Sheet } from "@/components/ui";
import { BrandMark } from "./BrandMark";
import { NAV_ITEMS } from "./navItems";

/**
 * Sticky header.
 *
 * The one-row guarantee (320px → 1920px) comes from three things, not from
 * media queries alone:
 *   1. the outer row is `flex-nowrap`, so nothing can ever drop to a second line;
 *   2. every child is `shrink-0` except the nav list, which is the only element
 *      allowed to absorb spare space;
 *   3. below 900px the link list and the desktop CTA are removed from the DOM
 *      (not merely hidden), so they cannot contribute width at all.
 *
 * Below 900px the row is logo | language pill | hamburger, which measures about
 * 250px at its natural size and therefore still fits a 320px viewport.
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className={[
        "glass-header sticky top-0 z-50 w-full",
        "border-b border-[rgba(11,42,61,0.09)]",
      ].join(" ")}
    >
      <div className="shell flex h-16 flex-nowrap items-center gap-3">
        {/* Brand ------------------------------------------------------- */}
        <a
          href="#top"
          className="rounded-pill flex min-h-11 shrink-0 items-center pe-1"
          aria-label={tCommon("brand")}
        >
          <BrandMark label={tCommon("brand")} />
        </a>

        {/* Desktop links — the only flexible element in the row. -------- */}
        <nav
          aria-label={t("menu")}
          className="wide:flex hidden min-w-0 flex-1 justify-center"
        >
          <ul className="flex flex-nowrap items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <a
                  href={item.hash}
                  className={[
                    "text-muted hover:text-ink hover:bg-ink/5 flex min-h-11 items-center",
                    "rounded-pill px-3 text-[15px] font-semibold whitespace-nowrap",
                    "transition-colors",
                  ].join(" ")}
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Spacer keeps the trailing cluster at the inline end when the
            desktop nav is absent. */}
        <div className="wide:hidden flex-1" />

        {/* Trailing cluster -------------------------------------------- */}
        <div className="flex shrink-0 items-center gap-2">
          <LocaleSwitcher variant="compact" />

          <a
            href="#booking"
            className={[
              "bg-brand text-ink-deep shadow-cta hidden min-h-11 items-center",
              "rounded-pill px-5 text-[15px] font-bold whitespace-nowrap",
              "wide:inline-flex transition-[filter] hover:brightness-105",
            ].join(" ")}
          >
            {t("bookCta")}
          </a>

          {/* Hamburger — mobile only. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("openMenu")}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className={[
              "tap-target text-ink hover:bg-ink/5 grid shrink-0 place-items-center",
              "rounded-pill wide:hidden transition-colors",
            ].join(" ")}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
              <path
                d="M2 5h16M2 10h16M2 15h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile navigation panel ---------------------------------------- */}
      <Sheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        variant="full"
        label={t("menu")}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2">
          <BrandMark label={tCommon("brand")} />
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label={t("closeMenu")}
            className="tap-target text-muted hover:bg-ink/5 -me-2 grid place-items-center rounded-full"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
              <path
                d="M3 3l10 10M13 3L3 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav aria-label={t("menu")} className="flex-1 px-5 pt-4">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <a
                  href={item.hash}
                  onClick={() => setMenuOpen(false)}
                  className={[
                    "text-ink hover:bg-ink/5 flex min-h-14 items-center rounded-2xl",
                    "px-3 text-[20px] font-semibold transition-colors",
                  ].join(" ")}
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Full-width CTA pinned to the bottom of the panel. */}
        <div className="mt-6 px-5">
          <a
            href="#booking"
            onClick={() => setMenuOpen(false)}
            className={[
              "bg-brand text-ink-deep shadow-cta flex min-h-13 w-full items-center",
              "rounded-pill justify-center px-6 text-base font-bold",
            ].join(" ")}
          >
            {t("bookCta")}
          </a>
        </div>
      </Sheet>
    </header>
  );
}

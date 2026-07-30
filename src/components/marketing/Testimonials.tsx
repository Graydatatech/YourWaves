"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { SectionIntro } from "./SectionIntro";

const ITEMS = ["one", "two", "three"] as const;
const RATING = 5;

function Stars({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={label}
      // The row is a single labelled image; the glyphs are decorative.
      dir="ltr"
    >
      {Array.from({ length: RATING }, (_, i) => (
        <svg
          key={i}
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="text-accent size-4 fill-current"
        >
          <path d="M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z" />
        </svg>
      ))}
    </div>
  );
}

/**
 * Three testimonial cards.
 *
 * Desktop: a plain 3-column grid.
 * Mobile: the same list becomes a scroll-snap carousel — one card per view —
 * with dot indicators. The dots reflect real scroll position (tracked with an
 * IntersectionObserver rather than a scroll handler, so there is no per-frame
 * work) and are also controls: activating one scrolls to that card.
 */
export function Testimonials() {
  const t = useTranslations("testimonials");
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const cards = Array.from(scroller.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(cards.indexOf(entry.target as HTMLElement));
          }
        }
      },
      // Only fire when a card is basically centred in the scroller.
      { root: scroller, threshold: 0.6 },
    );

    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  function goTo(index: number) {
    const scroller = scrollerRef.current;
    const card = scroller?.children[index] as HTMLElement | undefined;
    // `inline` keeps this correct in RTL, where "start" is the right edge.
    card?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }

  return (
    <div className="shell mt-20">
      <SectionIntro kicker={t("kicker")} title={t("title")} />

      <ul
        ref={scrollerRef}
        className={cn(
          // Mobile: snap carousel. From md: a static grid, no scrolling.
          "snap-row mt-10 gap-4 pb-2",
          "md:grid md:grid-cols-3 md:overflow-visible md:pb-0",
        )}
      >
        {ITEMS.map((item) => (
          <li
            key={item}
            className={cn(
              "border-border bg-surface shadow-card rounded-card border p-6",
              // One card per view, minus the gutter so the next card peeks.
              "w-[86%] shrink-0 snap-start md:w-auto",
            )}
          >
            <Stars label={t("ratingLabel", { rating: RATING })} />

            <blockquote className="text-ink mt-4 text-lg leading-relaxed font-semibold">
              {t(`items.${item}.quote`)}
            </blockquote>

            <figcaption className="mt-5 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="bg-brand size-9 shrink-0 rounded-full"
              />
              <span className="min-w-0">
                <span className="text-ink block truncate text-sm font-bold">
                  {t(`items.${item}.name`)}
                </span>
                <span className="text-muted-2 block truncate text-sm">
                  {t(`items.${item}.role`)}
                </span>
              </span>
            </figcaption>
          </li>
        ))}
      </ul>

      {/* Dot indicators — mobile only, since the grid shows all three at md+. */}
      <div className="mt-5 flex justify-center gap-2 md:hidden">
        {ITEMS.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => goTo(index)}
            aria-label={t("goToSlide", { number: index + 1 })}
            aria-current={index === active ? "true" : undefined}
            // 44px hit area via padding, with a small painted dot inside.
            className="tap-target grid place-items-center rounded-full"
          >
            <span
              className={cn(
                "block h-2 rounded-full transition-all duration-300",
                index === active ? "bg-accent w-6" : "bg-ink/20 w-2",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

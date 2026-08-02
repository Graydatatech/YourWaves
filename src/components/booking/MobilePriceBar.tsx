"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bidi, Sheet } from "@/components/ui";
import {
  formatMoney,
  formatShortDate,
  formatTime,
  type Locale,
} from "@/lib/booking/format";
import { PriceSummary } from "./PriceSummary";
import type { PublicSettings } from "./useBookingData";
import { useBooking } from "./BookingProvider";

export type MobilePriceBarProps = {
  locale: Locale;
  settings: PublicSettings;
  confirmed?: boolean;
};

/**
 * Persistent price bar for the mobile wizard.
 *
 * On a phone the summary must not be a sticky side card — there is no side. It
 * collapses to one always-visible row (total + a one-line recap of what has been
 * chosen so far), and tapping it opens the full breakdown in a bottom Sheet.
 * That keeps the running total on screen at every step without spending
 * vertical space that the current question needs.
 */
export function MobilePriceBar({
  locale,
  settings,
  confirmed = false,
}: MobilePriceBarProps) {
  const t = useTranslations("booking.summary");
  const { draft } = useBooking();
  const [open, setOpen] = useState(false);

  const total = formatMoney(settings.pricing.total, settings.currency, locale);

  // A compact recap: date, then time once chosen.
  const parts: string[] = [];
  if (draft.bookingDate) parts.push(formatShortDate(draft.bookingDate, locale));
  if (draft.preferredStart)
    parts.push(formatTime(draft.preferredStart, locale));
  const recap = parts.length > 0 ? parts.join(" · ") : t("nothingChosen");

  return (
    <>
      <button
        type="button"
        // Hook for the QA screenshot script: the summary is a bottom sheet on
        // mobile and a sticky card above 900px, and photographing the same
        // information in both layouts means opening the sheet.
        data-testid="price-bar-toggle"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="bg-summary border-border flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-start"
      >
        <span className="min-w-0">
          <span className="text-muted-2 block text-[11px] font-bold uppercase">
            {t("total")}
          </span>
          <span className="text-accent-strong font-display block text-[19px] leading-tight font-extrabold">
            <Bidi>{total}</Bidi>
          </span>
        </span>

        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted min-w-0 truncate text-xs font-semibold">
            <Bidi>{recap}</Bidi>
          </span>
          {/* Chevron points up: tapping opens upward into the sheet. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="text-accent size-3 shrink-0"
          >
            <path
              d="M1 8.5 6 3.5l5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("title")}
        className="pt-0"
      >
        <PriceSummary
          locale={locale}
          settings={settings}
          confirmed={confirmed}
          className="border-0 bg-transparent p-0"
        />
      </Sheet>
    </>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bidi } from "@/components/ui";
import { formatTime, type Locale } from "@/lib/booking/format";
import { normaliseTime } from "@/lib/dates";

export type TimePickerProps = {
  locale: Locale;
  /** Slots from /api/settings — never a hardcoded list. */
  slots: string[];
  value?: string;
  onChange: (time: string) => void;
  /** Shown when the field is required and empty. */
  describedById?: string;
};

/**
 * Start-time selection.
 *
 * A radiogroup rather than a set of buttons: exactly one may be chosen, and a
 * screen reader should announce "3 of 8" as the user arrows through. Native
 * radio semantics give that for free, so the arrow keys work without any
 * keyboard code of our own.
 *
 * The rendered time is locale-formatted (AM/PM in English, ص/م in Arabic) but
 * the VALUE stays "HH:MM:SS" — the display never becomes the data.
 */
export function TimePicker({
  locale,
  slots,
  value,
  onChange,
  describedById,
}: TimePickerProps) {
  const t = useTranslations("booking.time");

  if (slots.length === 0) {
    return (
      <p className="text-muted text-base" role="status">
        {t("noSlots")}
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      aria-describedby={describedById}
      className={cn(
        "grid gap-2.5",
        // At least 3 per row on the narrowest phone; auto-fills wider.
        "[grid-template-columns:repeat(auto-fit,minmax(84px,1fr))]",
      )}
    >
      {slots.map((slot) => {
        const normalised = normaliseTime(slot);
        const isSelected = value === normalised;
        return (
          <button
            key={normalised}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(normalised)}
            className={cn(
              "rounded-pill flex min-h-11 items-center justify-center px-3",
              "text-[15px] font-semibold whitespace-nowrap transition-colors",
              "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
              isSelected
                ? "bg-brand text-ink-deep shadow-cta font-bold"
                : "border-border bg-surface text-ink hover:border-accent/50 border",
            )}
          >
            {/* A clock time is a number run: keep it LTR inside Arabic. */}
            <Bidi>{formatTime(normalised, locale)}</Bidi>
          </button>
        );
      })}
    </div>
  );
}

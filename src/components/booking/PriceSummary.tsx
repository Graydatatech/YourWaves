"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bidi } from "@/components/ui";
import {
  formatFullDate,
  formatMoney,
  formatTime,
  type Locale,
} from "@/lib/booking/format";
import type { PublicSettings } from "./useBookingData";
import { useBooking } from "./BookingProvider";

export type PriceSummaryProps = {
  locale: Locale;
  settings: PublicSettings;
  /** Set once the payload has been accepted by the server. */
  confirmed?: boolean;
  className?: string;
};

/**
 * Line items and total.
 *
 * Every figure comes from /api/settings — nothing here is hardcoded, so a price
 * change in the database is live without a deploy. Amounts are minor units
 * formatted with Intl.NumberFormat and wrapped in <Bidi>, because a currency
 * amount is a number run that must read left-to-right even in Arabic.
 */
export function PriceSummary({
  locale,
  settings,
  confirmed = false,
  className,
}: PriceSummaryProps) {
  const t = useTranslations("booking.summary");
  const { draft, allComplete } = useBooking();

  const { pricing, currency } = settings;
  const money = (minor: number) => formatMoney(minor, currency, locale);

  /**
   * Zero lines are dropped rather than shown as "QAR 0".
   *
   * Since migration 0012 the business sells ONE full-day price, so setup and
   * delivery are zero and the breakdown would be two meaningless rows above a
   * total that equals the first one. The rows survive in code because a
   * historical booking priced under the old split still renders correctly.
   */
  const lines = (
    [
      { key: "rental", amount: pricing.rental },
      { key: "setup", amount: pricing.setup },
      { key: "delivery", amount: pricing.delivery },
    ] as const
  ).filter((line) => line.amount > 0);

  const statusKey = confirmed
    ? "statusConfirmed"
    : allComplete
      ? "statusReady"
      : "statusIncomplete";

  return (
    <div
      className={cn(
        "bg-summary rounded-card border-border border p-5 sm:p-6",
        className,
      )}
    >
      <h3 className="text-ink text-lg font-bold">{t("title")}</h3>

      {/* Chosen date & time ---------------------------------------------- */}
      <dl className="mt-4 space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted text-sm">{t("date")}</dt>
          <dd className="text-ink text-end text-sm font-bold">
            {draft.bookingDate ? (
              <Bidi>{formatFullDate(draft.bookingDate, locale)}</Bidi>
            ) : (
              <span className="text-muted-3">—</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted text-sm">{t("time")}</dt>
          <dd className="text-ink text-end text-sm font-bold">
            {/* Start time is mandatory (SRS 3.1) — an em dash until chosen. */}
            {draft.preferredStart ? (
              <Bidi>{formatTime(draft.preferredStart, locale)}</Bidi>
            ) : (
              <span className="text-muted-3">—</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Line items ------------------------------------------------------- */}
      <dl className="mt-5">
        {lines.map((line) => (
          <div
            key={line.key}
            className={cn(
              "flex items-baseline justify-between gap-4 py-2.5",
              "border-ink/12 border-b border-dashed",
            )}
          >
            <dt className="text-muted text-sm">{t(`lines.${line.key}`)}</dt>
            <dd className="text-ink text-sm font-semibold">
              <Bidi>{money(line.amount)}</Bidi>
            </dd>
          </div>
        ))}
      </dl>

      {/* Total ------------------------------------------------------------ */}
      <div className="mt-4 flex items-baseline justify-between gap-4">
        <span className="text-ink text-sm font-bold">{t("total")}</span>
        <span className="font-display text-accent-strong text-[26px] leading-none font-extrabold">
          <Bidi>{money(pricing.total)}</Bidi>
        </span>
      </div>

      <p className="text-muted mt-4 text-sm" role="status" aria-live="polite">
        {t(statusKey)}
      </p>
    </div>
  );
}

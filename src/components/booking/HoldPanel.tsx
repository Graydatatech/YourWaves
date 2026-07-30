"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bidi } from "@/components/ui";
import { formatMoney, type Locale } from "@/lib/booking/format";
import {
  formatRemaining,
  WARN_AT_SECONDS,
  type HoldErrorCode,
  type HoldPhase,
} from "./useHold";

export type HoldPanelProps = {
  locale: Locale;
  phase: HoldPhase;
  remaining: number;
  warning: boolean;
  error: HoldErrorCode | null;
  reference?: string;
  priceTotal?: number;
  currency?: string;
  onRetry: () => void;
  onRelease: () => void;
  onBackToCalendar: () => void;
  busy: boolean;
  /** Starts checkout. Absent means payment is not available. */
  onPay?: () => void;
  paying?: boolean;
  payError?: string | null;
};

/**
 * The state of the hold, in words.
 *
 * The expiry case is the one that matters. A hold lapsing is not an error the
 * customer caused, and it usually does NOT mean the date has gone — most holds
 * expire because somebody took a phone call. So the recovery screen says the
 * date may still be free and offers a single button that re-runs the hold with
 * the inputs still in place. Their answers are never discarded: the draft lives
 * in sessionStorage independently of the hold.
 */
export function HoldPanel({
  locale,
  phase,
  remaining,
  warning,
  error,
  reference,
  priceTotal,
  currency,
  onRetry,
  onRelease,
  onBackToCalendar,
  busy,
  onPay,
  paying = false,
  payError = null,
}: HoldPanelProps) {
  const t = useTranslations("booking.hold");
  const tErr = useTranslations("booking.holdErrors");
  const tPay = useTranslations("booking.pay");

  // --- Held ---------------------------------------------------------------
  if (phase === "active") {
    return (
      <div
        className={cn(
          "rounded-card border p-5",
          warning
            ? "border-amber-500/50 bg-amber-50"
            : "border-accent/30 bg-summary",
        )}
        // polite, not assertive: this updates every second and must not
        // interrupt a screen reader mid-sentence.
        role="status"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-ink text-base font-bold">
            {warning ? t("endingSoonTitle") : t("heldTitle")}
          </h3>
          <span
            className={cn(
              "font-display text-[26px] leading-none font-extrabold tabular-nums",
              warning ? "text-amber-700" : "text-accent-strong",
            )}
          >
            <Bidi>{formatRemaining(remaining)}</Bidi>
          </span>
        </div>

        <p className="text-muted mt-2 text-sm">
          {warning ? t("endingSoonBody") : t("heldBody")}
        </p>

        {reference && (
          <p className="text-muted-2 mt-3 text-xs font-semibold">
            {t("reference")} <Bidi>{reference}</Bidi>
          </p>
        )}

        {priceTotal !== undefined && currency && (
          <p className="text-ink mt-1 text-sm font-bold">
            {t("total")}{" "}
            <Bidi>{formatMoney(priceTotal, currency, locale)}</Bidi>
          </p>
        )}

        {onPay && (
          <>
            <button
              type="button"
              onClick={onPay}
              disabled={paying || busy}
              className={cn(
                "bg-brand text-ink-deep shadow-cta mt-5 flex min-h-13 w-full",
                "rounded-pill items-center justify-center px-6 text-base font-bold",
                "transition-[filter] hover:brightness-105",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
            >
              {paying ? tPay("starting") : tPay("cta")}
            </button>
            <p className="text-muted-2 mt-2 text-xs">{tPay("secureNote")}</p>
            <p
              role="alert"
              aria-live="polite"
              className="mt-2 text-sm font-semibold text-red-600 empty:hidden"
            >
              {payError ?? ""}
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onRelease}
          disabled={busy || paying}
          className="text-muted hover:text-ink mt-4 min-h-11 text-sm font-semibold underline disabled:opacity-50"
        >
          {t("release")}
        </button>
      </div>
    );
  }

  // --- Expired: recovery, not a dead end ----------------------------------
  if (phase === "expired") {
    return (
      <div
        className="rounded-card border border-amber-500/50 bg-amber-50 p-5"
        role="alert"
      >
        <h3 className="text-ink text-base font-bold">{t("expiredTitle")}</h3>
        <p className="text-muted mt-2 text-sm">{t("expiredBody")}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className={cn(
              "bg-brand text-ink-deep shadow-cta inline-flex min-h-12 items-center",
              "rounded-pill justify-center px-6 text-[15px] font-bold",
              "transition-[filter] hover:brightness-105",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {busy ? t("retrying") : t("retry")}
          </button>
          <button
            type="button"
            onClick={onBackToCalendar}
            disabled={busy}
            className={cn(
              "border-border bg-surface text-ink hover:border-accent/50",
              "rounded-pill inline-flex min-h-12 items-center border px-5",
              "text-[15px] font-semibold transition-colors disabled:opacity-50",
            )}
          >
            {t("chooseAnother")}
          </button>
        </div>
      </div>
    );
  }

  // --- Refused ------------------------------------------------------------
  if (phase === "error" && error) {
    // DATE_TAKEN is the only one where a different date is the fix; the rest
    // mean this date was never bookable, so retrying it unchanged is pointless.
    const dateIsGone = error === "DATE_TAKEN";
    return (
      <div
        className="rounded-card border border-red-500/40 bg-red-50 p-5"
        role="alert"
      >
        <h3 className="text-ink text-base font-bold">{t("refusedTitle")}</h3>
        <p className="mt-2 text-sm font-semibold text-red-700">{tErr(error)}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={dateIsGone ? onBackToCalendar : onRetry}
            disabled={busy}
            className={cn(
              "bg-brand text-ink-deep shadow-cta inline-flex min-h-12 items-center",
              "rounded-pill justify-center px-6 text-[15px] font-bold",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {dateIsGone ? t("chooseAnother") : t("retry")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "released") {
    return (
      <div
        className="rounded-card border-border bg-surface border p-5"
        role="status"
      >
        <p className="text-muted text-sm">{t("releasedBody")}</p>
        <button
          type="button"
          onClick={onBackToCalendar}
          className="text-accent-strong mt-3 min-h-11 text-sm font-bold underline"
        >
          {t("chooseAnother")}
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Compact countdown for the mobile sticky bar, so the time remaining is visible
 * at every step rather than only on the screen that created the hold.
 */
export function HoldCountdownChip({
  remaining,
  warning,
}: {
  remaining: number;
  warning: boolean;
}) {
  const t = useTranslations("booking.hold");
  return (
    <span
      className={cn(
        "rounded-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold",
        warning
          ? "bg-amber-100 text-amber-800"
          : "bg-accent/12 text-accent-strong",
      )}
      role="timer"
      aria-live="off"
      aria-label={t("srCountdown", { time: formatRemaining(remaining) })}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3">
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M8 5v3.2l2 1.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <Bidi>{formatRemaining(remaining)}</Bidi>
    </span>
  );
}

export { WARN_AT_SECONDS };

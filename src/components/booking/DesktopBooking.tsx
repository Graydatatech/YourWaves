"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { PriceSummary } from "./PriceSummary";
import {
  DateStepBody,
  DetailsStepBody,
  TermsStepBody,
  LocationStepBody,
  TimeStepBody,
  type StepBodyProps,
} from "./BookingSteps";
import { useBooking } from "./BookingProvider";

export type DesktopBookingProps = StepBodyProps & {
  submitting: boolean;
  holdActive: boolean;
  onSubmit: () => void;
};

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border border-t pt-6 first:border-0 first:pt-0">
      <h3 className="text-ink mb-4 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Two columns from 900px up: everything in one scrollable card on the left, the
 * price summary sticky on the right.
 *
 * No wizard here — with the vertical room available, showing every section at
 * once lets the customer see the whole commitment before filling it in, and
 * jump straight to the field they want to change.
 */
export function DesktopBooking({
  submitting,
  holdActive,
  onSubmit,
  ...stepProps
}: DesktopBookingProps) {
  const t = useTranslations("booking");
  const tSteps = useTranslations("booking.steps");
  const tErrors = useTranslations("booking.errors");
  const tHold = useTranslations("booking.hold");
  // `steps` decides whether the terms section exists at all, exactly as it
  // does for the wizard — the two layouts must ask for the same things.
  const { allComplete, errorFor, steps } = useBooking();
  const showTerms = steps.includes("terms");

  // The first unmet requirement, so the button explains itself.
  const firstProblem =
    errorFor("date") ??
    errorFor("time") ??
    errorFor("details") ??
    errorFor("location") ??
    // Last, matching the order the sections are stacked in — the button should
    // name the problem nearest the top of the form, not the newest one.
    (showTerms ? errorFor("terms") : null);

  return (
    <div className="wide:grid-cols-[minmax(0,1fr)_360px] wide:items-start grid gap-8">
      <div
        className={cn(
          "border-border bg-surface shadow-card rounded-card border",
          "space-y-6 p-6 sm:p-8",
        )}
      >
        <Block title={tSteps("dateTitle")}>
          <DateStepBody {...stepProps} />
        </Block>
        <Block title={tSteps("timeTitle")}>
          <TimeStepBody {...stepProps} />
        </Block>
        {/* Details before location, matching STEP_ORDER — the two layouts must
            ask for the same things in the same sequence. */}
        <Block title={tSteps("detailsTitle")}>
          <DetailsStepBody />
        </Block>
        <Block title={tSteps("locationTitle")}>
          <LocationStepBody {...stepProps} />
        </Block>
        {showTerms && (
          <Block title={tSteps("termsTitle")}>
            <TermsStepBody locale={stepProps.locale} />
          </Block>
        )}
      </div>

      {/* Sticky summary column. */}
      <div className="wide:sticky wide:top-[var(--summary-sticky-top)] space-y-4">
        <PriceSummary
          locale={stepProps.locale}
          settings={stepProps.settings}
          confirmed={holdActive}
        />

        <p
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-danger empty:hidden"
        >
          {!allComplete && firstProblem ? tErrors(firstProblem) : ""}
        </p>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!allComplete || submitting || holdActive}
          className={cn(
            "bg-brand text-ink-deep shadow-cta flex min-h-13 w-full items-center",
            "rounded-pill justify-center px-6 text-base font-bold",
            "transition-[filter] hover:brightness-105",
            "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
          )}
        >
          {submitting
            ? t("submitting")
            : holdActive
              ? tHold("heldTitle")
              : t("submit")}
        </button>
      </div>
    </div>
  );
}

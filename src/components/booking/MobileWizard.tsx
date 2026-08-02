"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { STEP_ORDER } from "@/lib/booking/schema";
import { WizardProgress } from "./WizardProgress";
import { HoldCountdownChip } from "./HoldPanel";
import { MobilePriceBar } from "./MobilePriceBar";
import {
  DateStepBody,
  DetailsStepBody,
  LocationStepBody,
  StepHeading,
  TimeStepBody,
  type StepBodyProps,
} from "./BookingSteps";
import { useBooking } from "./BookingProvider";

export type MobileWizardProps = StepBodyProps & {
  submitting: boolean;
  /** True while a hold is live — the date is locked and payment is next. */
  holdActive: boolean;
  holdRemaining: number;
  holdWarning: boolean;
  onSubmit: () => void;
};

/**
 * One question per screen.
 *
 * Layout: progress pinned at the top, the step body in the middle, and the price
 * bar plus back/next pinned at the bottom above the safe area. The footer uses
 * `position: sticky` rather than `fixed` because this wizard is embedded in the
 * landing page — `fixed` would float the controls over the FAQ and footer too.
 *
 * "Next" is never a silently dead button: when the step is incomplete it is
 * disabled AND the reason is rendered next to it, wired up with aria-live so a
 * screen reader hears why nothing happened.
 */
export function MobileWizard({
  submitting,
  holdActive,
  holdRemaining,
  holdWarning,
  onSubmit,
  ...stepProps
}: MobileWizardProps) {
  const t = useTranslations("booking");
  const tErrors = useTranslations("booking.errors");
  const tHold = useTranslations("booking.hold");
  const { step, stepIndex, next, back, errorFor, showErrorFor } = useBooking();

  const isLast = stepIndex === STEP_ORDER.length - 1;
  const error = errorFor(step);
  const blocked = error !== null;
  // Show the reason once they have tried to advance, or as soon as they are on
  // the last step and pressing submit would fail.
  const reason = blocked && showErrorFor(step) ? tErrors(error) : null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Progress — sticks under the 64px site header. */}
      <div className="glass-header sticky top-16 z-20 -mx-[var(--gutter)] px-[var(--gutter)] py-3">
        <WizardProgress />
      </div>

      {/* Step body */}
      <div className="flex-1 py-6">
        <StepHeading stepKey={step} />

        {step === "date" && <DateStepBody {...stepProps} />}
        {step === "time" && <TimeStepBody {...stepProps} />}
        {step === "location" && <LocationStepBody {...stepProps} />}
        {step === "details" && <DetailsStepBody />}
      </div>

      {/* Footer: price bar + controls, above the home indicator. */}
      <div
        className={cn(
          "glass-header sticky bottom-0 z-20 -mx-[var(--gutter)] px-[var(--gutter)]",
          "border-border space-y-3 border-t pt-3",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <MobilePriceBar
              locale={stepProps.locale}
              settings={stepProps.settings}
              confirmed={holdActive}
            />
          </div>
          {/* The countdown lives here so it is on screen at every step, not
              only on the one that created the hold. */}
          {holdActive && (
            <HoldCountdownChip
              remaining={holdRemaining}
              warning={holdWarning}
            />
          )}
        </div>

        {/* The reason "Next" is unavailable, announced when it appears. */}
        <p
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-danger empty:hidden"
        >
          {reason ?? ""}
        </p>

        <div className="flex items-center gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              className={cn(
                "border-border bg-surface text-ink hover:border-accent/50",
                "rounded-pill min-h-13 shrink-0 border px-5 text-base font-bold",
                "transition-colors",
              )}
            >
              {t("back")}
            </button>
          )}

          <button
            type="button"
            // A stable hook for the QA screenshot script, which has to drive
            // the wizard four steps deep to photograph the later ones. The
            // label is translated and the classes are styling, so neither is
            // something a script can select on without breaking on the next
            // copy change.
            data-testid="wizard-next"
            onClick={isLast ? onSubmit : next}
            disabled={blocked || submitting || (isLast && holdActive)}
            className={cn(
              "bg-brand text-ink-deep shadow-cta flex min-h-13 flex-1 items-center",
              "rounded-pill justify-center px-6 text-base font-bold",
              "transition-[filter] hover:brightness-105",
              "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
            )}
          >
            {submitting
              ? t("submitting")
              : isLast
                ? holdActive
                  ? tHold("heldTitle")
                  : t("submit")
                : t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}

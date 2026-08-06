"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { type StepKey } from "@/lib/booking/schema";
import { useBooking } from "./BookingProvider";

/**
 * Step indicator for the mobile wizard.
 *
 * Rendered as an ordered list so the sequence is conveyed structurally, with
 * `aria-current="step"` on the active one. Completed steps are tappable so the
 * customer can go back and change an answer; steps ahead are not, because their
 * prerequisites are not met yet.
 */
export function WizardProgress() {
  const t = useTranslations("booking.steps");
  // `steps`, not STEP_ORDER: the terms step is absent when the business has
  // written none, and a dot leading nowhere is worse than one fewer dot.
  const { step, stepIndex, steps, goTo, isStepComplete } = useBooking();

  return (
    <nav aria-label={t("progressLabel")}>
      <ol className="flex items-center gap-1.5">
        {steps.map((key: StepKey, index) => {
          const isActive = key === step;
          const isDone = index < stepIndex && isStepComplete(key);
          const reachable = index <= stepIndex || isStepComplete(key);

          return (
            <li key={key} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => reachable && goTo(key)}
                aria-current={isActive ? "step" : undefined}
                disabled={!reachable}
                className={cn(
                  "group flex min-h-11 w-full flex-col justify-center gap-1.5",
                  "rounded-lg px-0.5",
                  "focus-visible:outline-focus focus-visible:outline-2",
                  reachable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors",
                    isActive && "bg-brand",
                    !isActive && isDone && "bg-accent/60",
                    !isActive && !isDone && "bg-ink/12",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[11px] font-bold",
                    isActive ? "text-ink" : "text-muted-2",
                  )}
                >
                  {t(key)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Calendar } from "./Calendar";
import { TimePicker } from "./TimePicker";
import { LocationStep } from "./LocationStep";
import { DetailsStep } from "./DetailsStep";
import { useBooking } from "./BookingProvider";
import type { PublicSettings } from "./useBookingData";
import type { DayState } from "@/lib/availability";
import type { IsoDate, IsoMonth } from "@/lib/dates";
import type { Locale } from "@/lib/booking/format";
import type { StepKey } from "@/lib/booking/schema";

/**
 * The four step bodies, shared verbatim by the mobile wizard and the desktop
 * single-card layout. Rendering the same components in both keeps the two
 * layouts from drifting into different behaviour.
 */

export type StepBodyProps = {
  locale: Locale;
  settings: PublicSettings;
  month: IsoMonth;
  onMonthChange: (month: IsoMonth) => void;
  minMonth: IsoMonth;
  states: ReadonlyMap<IsoDate, DayState>;
  availabilityLoading: boolean;
};

export function DateStepBody({
  locale,
  month,
  onMonthChange,
  minMonth,
  states,
  availabilityLoading,
}: StepBodyProps) {
  const { draft, patch } = useBooking();
  return (
    <Calendar
      locale={locale}
      month={month}
      onMonthChange={onMonthChange}
      minMonth={minMonth}
      states={states}
      selected={draft.bookingDate}
      loading={availabilityLoading}
      onSelect={(date) => patch({ bookingDate: date })}
    />
  );
}

export function TimeStepBody({ locale, settings }: StepBodyProps) {
  const { draft, patch } = useBooking();
  return (
    <TimePicker
      locale={locale}
      slots={settings.availableStartTimes}
      value={draft.preferredStart}
      onChange={(time) => patch({ preferredStart: time })}
    />
  );
}

export function LocationStepBody({ locale, settings }: StepBodyProps) {
  const { showErrorFor } = useBooking();
  return (
    <LocationStep
      locale={locale}
      serviceAreas={settings.serviceAreas}
      showErrors={showErrorFor("location")}
    />
  );
}

export function DetailsStepBody() {
  const { showErrorFor } = useBooking();
  return <DetailsStep showErrors={showErrorFor("details")} />;
}

/** Heading + helper text for a step, used by both layouts. */
export function StepHeading({ stepKey }: { stepKey: StepKey }) {
  const t = useTranslations("booking.steps");
  return (
    <div className="mb-5">
      <h3 className="text-ink text-xl font-bold">{t(`${stepKey}Title`)}</h3>
      {/* text-sm, matching every other hint in the form (the field hints in
          DetailsStep and LocationStep are all text-sm). At text-base this sat
          at the same weight as the answer the customer is being asked for, so
          the heading and its aside read as two competing instructions.

          `text-muted` rather than the `text-muted-2` those field hints use:
          shrinking type and lightening it at the same time is how a line ends
          up unread. muted is 6.06:1 on the painted page background, muted-2 is
          5.20 — both pass AA, and at 14px the darker one is the one to spend. */}
      <p className="text-muted mt-1.5 text-sm">{t(`${stepKey}Help`)}</p>
    </div>
  );
}

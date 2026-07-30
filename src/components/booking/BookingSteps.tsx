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
      <p className="text-muted mt-1.5 text-base">{t(`${stepKey}Help`)}</p>
    </div>
  );
}

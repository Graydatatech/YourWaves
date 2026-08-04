import {
  addDays,
  compareIsoDate,
  datesInMonth,
  qatarToday,
  qatarWallClockToInstant,
  type IsoDate,
  type IsoMonth,
  type IsoTime,
} from "./dates";

/**
 * Why a day cannot be booked — or that it can.
 *
 * Deliberately a closed set the UI can switch on exhaustively; the calendar in
 * phase 3 renders a different affordance for each.
 */
export type DayState =
  "available" | "booked" | "blackout" | "past" | "too_soon";

export type AvailabilityDay = {
  date: IsoDate;
  state: DayState;
};

export type AvailabilityInput = {
  month: IsoMonth;
  /** Injected so the calculation is deterministic and testable. */
  now: Date;
  /** Minimum notice required before the first slot of a day. */
  leadTimeHours: number;
  /** How far ahead the calendar is open. Days beyond are omitted entirely. */
  maxAdvanceDays: number;
  /** The earliest bookable booking time, Qatar wall clock. */
  earliestStartTime: IsoTime;
  /** Days occupied by a booking in a blocking status. */
  bookedDates: ReadonlySet<IsoDate>;
  /** Days blocked by an admin. */
  blackoutDates: ReadonlySet<IsoDate>;
};

/**
 * Computes the state of every day in a month.
 *
 * Pure: no clock, no database, no timezone of the host. Everything that varies
 * is a parameter, which is what makes the lead-time boundary testable to the
 * second.
 *
 * Precedence, highest first:
 *   1. past      — the day is over in Qatar; nothing else matters
 *   2. booked    — someone holds it; the most useful thing to tell a customer
 *   3. blackout  — admin closed the day
 *   4. too_soon  — bookable in principle, but not at this notice
 *   5. available
 *
 * Days further ahead than `maxAdvanceDays` are omitted from the result rather
 * than given a state, so the client cannot render them at all.
 */
export function computeAvailability(
  input: AvailabilityInput,
): AvailabilityDay[] {
  const {
    month,
    now,
    leadTimeHours,
    maxAdvanceDays,
    earliestStartTime,
    bookedDates,
    blackoutDates,
  } = input;

  const today = qatarToday(now);
  const lastBookable = addDays(today, maxAdvanceDays);
  const leadCutoff = now.getTime() + leadTimeHours * 3_600_000;

  const days: AvailabilityDay[] = [];

  for (const date of datesInMonth(month)) {
    if (compareIsoDate(date, today) < 0) {
      days.push({ date, state: "past" });
      continue;
    }

    // Beyond the booking horizon: not returned at all.
    if (compareIsoDate(date, lastBookable) > 0) continue;

    if (bookedDates.has(date)) {
      days.push({ date, state: "booked" });
      continue;
    }

    if (blackoutDates.has(date)) {
      days.push({ date, state: "blackout" });
      continue;
    }

    // The day is bookable only if its FIRST slot is still far enough away.
    // `<=` means a day sitting exactly on the lead-time boundary is too soon:
    // the notice period must be genuinely satisfied, not merely equalled.
    const earliestSlot = qatarWallClockToInstant(date, earliestStartTime);
    if (earliestSlot.getTime() <= leadCutoff) {
      days.push({ date, state: "too_soon" });
      continue;
    }

    days.push({ date, state: "available" });
  }

  return days;
}

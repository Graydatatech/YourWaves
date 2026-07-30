/**
 * The single place any booking date is parsed, formatted or compared.
 *
 * WHY THIS FILE EXISTS
 * A booking reserves a *calendar day* in Qatar, not an instant. If any code
 * path lets a JS `Date` carry a booking day through a timezone conversion, a
 * customer in UTC-5 booking "14 August" can end up with 13 August stored — the
 * classic off-by-one that is very hard to notice until a driver shows up on the
 * wrong morning.
 *
 * The rules, enforced by using only this module:
 *   1. A booking day is an `IsoDate` string ("YYYY-MM-DD"), never a `Date`.
 *   2. Postgres stores it in a `date` column, never `timestamp`.
 *   3. A `Date` is only ever produced when we genuinely need an *instant*
 *      (e.g. "is this slot far enough in the future?"), and always via
 *      `qatarWallClockToInstant`.
 *   4. Nothing here reads the host's local timezone. Every conversion names
 *      Asia/Qatar explicitly, so the server's TZ, the CI runner's TZ and the
 *      browser's TZ are all irrelevant.
 *
 * Qatar is UTC+3 year-round and has never observed daylight saving. The offset
 * is still derived from the IANA database rather than hardcoded, so this stays
 * correct if that ever changes.
 */

export const QATAR_TIME_ZONE = "Asia/Qatar";

/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string;
/** Wall-clock time, "HH:MM" or "HH:MM:SS". */
export type IsoTime = string;
/** Calendar month, "YYYY-MM". */
export type IsoMonth = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_RE = /^(\d{4})-(\d{2})$/;
const ISO_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: QATAR_TIME_ZONE,
  // h23 rather than hour12:false — some ICU builds emit "24" for midnight
  // under hour12:false, which silently breaks the offset maths below.
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The Qatar wall-clock reading of a given instant. */
function qatarWallClock(instant: Date): WallClock {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing "${type}" from Intl parts`);
    return Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Milliseconds Qatar is ahead of UTC at a given instant (+3h, always). */
function qatarOffsetMs(instant: Date): number {
  const wall = qatarWallClock(instant);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asIfUtc - instant.getTime();
}

// --- Validation -------------------------------------------------------------

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isIsoMonth(value: string): value is IsoMonth {
  const match = ISO_MONTH_RE.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  return value;
}

// --- Calendar arithmetic (pure strings, no Date, no timezone) ---------------

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. Date.UTC keeps this
  // free of any local-timezone influence.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function splitIsoDate(date: IsoDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = ISO_DATE_RE.exec(assertIsoDate(date));
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function splitIsoMonth(month: IsoMonth): {
  year: number;
  month: number;
} {
  const match = ISO_MONTH_RE.exec(month);
  if (!match) throw new Error(`Invalid ISO month: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Shifts a calendar date by whole days. Pure arithmetic — never shifts zone. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = splitIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIsoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function differenceInDays(from: IsoDate, to: IsoDate): number {
  const a = splitIsoDate(from);
  const b = splitIsoDate(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** ISO dates are lexicographically ordered, so plain comparison is correct. */
export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every calendar day in a month, in order. */
export function datesInMonth(month: IsoMonth): IsoDate[] {
  const { year, month: m } = splitIsoMonth(month);
  const total = daysInMonth(year, m);
  return Array.from({ length: total }, (_, i) => toIsoDate(year, m, i + 1));
}

// --- Instant <-> calendar conversions (the only tz-aware code) --------------

/** The calendar date in Qatar at a given instant. */
export function qatarDateOf(instant: Date): IsoDate {
  const wall = qatarWallClock(instant);
  return toIsoDate(wall.year, wall.month, wall.day);
}

/** Today's calendar date in Qatar. */
export function qatarToday(now: Date = new Date()): IsoDate {
  return qatarDateOf(now);
}

/**
 * Converts a Qatar wall-clock date + time into the corresponding UTC instant.
 *
 * Works by guessing that the wall clock is UTC, measuring the zone offset at
 * that approximate instant, then correcting. The result is re-checked once so
 * the answer stays right across a hypothetical DST transition.
 */
export function qatarWallClockToInstant(date: IsoDate, time: IsoTime): Date {
  const { year, month, day } = splitIsoDate(date);
  const match = ISO_TIME_RE.exec(time);
  if (!match) throw new Error(`Invalid ISO time: ${JSON.stringify(time)}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid ISO time: ${JSON.stringify(time)}`);
  }

  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naive - qatarOffsetMs(new Date(naive)));
  const refinedOffset = qatarOffsetMs(firstGuess);
  return new Date(naive - refinedOffset);
}

/** Start of a Qatar calendar day (00:00 Qatar) as a UTC instant. */
export function qatarStartOfDay(date: IsoDate): Date {
  return qatarWallClockToInstant(date, "00:00:00");
}

/** Normalises "8:00", "08:00" and "08:00:00" to "HH:MM:SS" for Postgres `time`. */
export function normaliseTime(time: string): IsoTime {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) throw new Error(`Invalid time: ${JSON.stringify(time)}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid time: ${JSON.stringify(time)}`);
  }
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

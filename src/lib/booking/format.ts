import {
  QATAR_TIME_ZONE,
  splitIsoDate,
  type IsoDate,
  type IsoTime,
} from "@/lib/dates";

/**
 * Presentation helpers for the booking flow.
 *
 * Everything here is locale-aware and everything numeric is meant to be wrapped
 * in <Bidi> at the call site — see the bidi note in CLAUDE.md. These functions
 * produce the *string*; the component decides the isolation.
 */

export type Locale = "ar" | "en";

/**
 * Formats minor units as a currency amount.
 *
 * Note `numberingSystem: "latn"`: Arabic locales default to Eastern Arabic
 * numerals (٤٥٠٠), which look wrong beside a Latin currency code and are hard
 * to scan for a price. Qatari commercial practice is Latin digits, so we pin
 * them and let the surrounding text stay Arabic.
 */
export function formatMoney(
  minorUnits: number,
  currency: string,
  locale: Locale,
): string {
  return new Intl.NumberFormat(`${locale}-QA-u-nu-latn`, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(minorUnits / 100);
}

/** "08:00:00" → "8:00 AM" / "٨:٠٠ ص" — with Latin digits pinned as above. */
export function formatTime(time: IsoTime, locale: Locale): string {
  const [hour, minute] = time.split(":").map(Number);
  // A fixed reference date: only the clock parts are read.
  const reference = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(reference);
}

/** "2026-08-14" → "Friday, 14 August 2026" / "الجمعة، ١٤ أغسطس ٢٠٢٦". */
export function formatFullDate(date: IsoDate, locale: Locale): string {
  const { year, month, day } = splitIsoDate(date);
  // Noon UTC keeps the date stable regardless of the formatter's zone maths.
  const reference = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(reference);
}

/** Short form for the compact mobile price bar: "14 Aug". */
export function formatShortDate(date: IsoDate, locale: Locale): string {
  const { year, month, day } = splitIsoDate(date);
  const reference = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(reference);
}

/** "2026-08" → "August 2026" / "أغسطس ٢٠٢٦". */
export function formatMonthLabel(
  year: number,
  month: number,
  locale: Locale,
): string {
  const reference = new Date(Date.UTC(year, month - 1, 1, 12));
  return new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(reference);
}

/**
 * Weekday header labels, Sunday first, in the active locale.
 *
 * Sunday-first is deliberate and not a locale default: the Qatari working week
 * runs Sunday–Thursday, so a Monday-first grid would read wrong to the primary
 * audience. 2024-01-07 was a Sunday; we walk seven days from there.
 */
export function weekdayLabels(
  locale: Locale,
  width: "short" | "narrow" = "short",
): string[] {
  const formatter = new Intl.DateTimeFormat(`${locale}-QA`, {
    weekday: width,
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2024, 0, 7 + i, 12))),
  );
}

/** Full weekday name, for the calendar cell's accessible label. */
export function formatCellLabel(date: IsoDate, locale: Locale): string {
  return formatFullDate(date, locale);
}

export { QATAR_TIME_ZONE };

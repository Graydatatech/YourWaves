"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  addDays,
  compareIsoDate,
  datesInMonth,
  splitIsoMonth,
  toIsoDate,
  type IsoDate,
  type IsoMonth,
} from "@/lib/dates";
import {
  formatCellLabel,
  formatMonthLabel,
  weekdayLabels,
  type Locale,
} from "@/lib/booking/format";
import type { DayState } from "@/lib/availability";

export type CalendarProps = {
  locale: Locale;
  /** Month currently displayed, "YYYY-MM". */
  month: IsoMonth;
  onMonthChange: (month: IsoMonth) => void;
  /** Earliest month the user may navigate back to. */
  minMonth: IsoMonth;
  /** Day states from /api/availability. Missing = beyond the booking horizon. */
  states: ReadonlyMap<IsoDate, DayState>;
  selected?: IsoDate;
  onSelect: (date: IsoDate) => void;
  loading?: boolean;
};

const SELECTABLE: ReadonlySet<DayState> = new Set(["available"]);

function shiftMonth(month: IsoMonth, delta: number): IsoMonth {
  const { year, month: m } = splitIsoMonth(month);
  const index = year * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(
    (index % 12) + 1,
  ).padStart(2, "0")}`;
}

/**
 * Month grid with full keyboard support.
 *
 * Accessibility model: `role="grid"` with one `role="row"` per week and a
 * `role="gridcell"` per day, plus a roving tabindex — exactly one cell is in the
 * tab order, and the arrow keys move focus within the grid. That is what lets a
 * keyboard user leave the calendar with a single Tab instead of pressing it
 * thirty-one times.
 *
 * Unavailable days keep `aria-disabled="true"` rather than the `disabled`
 * attribute: a disabled element is skipped by focus, so a screen-reader user
 * would never hear that the 14th is booked. This way they land on it and are
 * told.
 *
 * RTL: the grid mirrors for free because CSS grid follows the inline direction,
 * so Sunday sits at the inline-start edge in both languages. The arrow KEYS,
 * however, must follow what the user sees — ArrowRight moves to the *previous*
 * day in Arabic — so their meaning is flipped from `dir`.
 */
export function Calendar({
  locale,
  month,
  onMonthChange,
  minMonth,
  states,
  selected,
  onSelect,
  loading = false,
}: CalendarProps) {
  const t = useTranslations("booking.calendar");
  const gridRef = useRef<HTMLDivElement>(null);
  const isRtl = locale === "ar";

  const days = useMemo(() => datesInMonth(month), [month]);
  const { year, month: monthNumber } = splitIsoMonth(month);

  /**
   * Leading blanks so the 1st lands under its weekday. Sunday-indexed to match
   * the header — see weekdayLabels() for why Sunday leads.
   */
  const leadingBlanks = useMemo(() => {
    const first = new Date(Date.UTC(year, monthNumber - 1, 1));
    return first.getUTCDay();
  }, [year, monthNumber]);

  const weeks = useMemo(() => {
    const cells: (IsoDate | null)[] = [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) =>
      cells.slice(i * 7, i * 7 + 7),
    );
  }, [days, leadingBlanks]);

  /**
   * The cell holding the roving tabindex.
   *
   * Stored loosely and DERIVED on read rather than synced with an effect: when
   * the month changes, the stored date simply stops matching and the fallback
   * takes over. An effect that corrected the value after the fact would render
   * one frame with a tabindex pointing at a cell that is no longer on screen.
   */
  const [preferredActive, setPreferredActive] = useState<IsoDate | null>(null);

  const activeDate: IsoDate =
    preferredActive && preferredActive.startsWith(month)
      ? preferredActive
      : selected && selected.startsWith(month)
        ? selected
        : (days.find((d) => SELECTABLE.has(states.get(d) ?? "past")) ??
          days[0]);

  // Only move focus when the user drove the change, never on first paint.
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    const node = gridRef.current?.querySelector<HTMLElement>(
      `[data-date="${activeDate}"]`,
    );
    node?.focus();
  }, [activeDate]);

  const moveTo = useCallback(
    (target: IsoDate) => {
      shouldFocus.current = true;
      if (!target.startsWith(month)) {
        onMonthChange(target.slice(0, 7));
      }
      setPreferredActive(target);
    },
    [month, onMonthChange],
  );

  const canGoBack = compareIsoDate(`${month}-01`, `${minMonth}-01`) > 0;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // In RTL the horizontal arrows are mirrored so they follow the layout.
      const back = isRtl ? "ArrowRight" : "ArrowLeft";
      const forward = isRtl ? "ArrowLeft" : "ArrowRight";

      let target: IsoDate | null = null;
      switch (event.key) {
        case back:
          target = addDays(activeDate, -1);
          break;
        case forward:
          target = addDays(activeDate, 1);
          break;
        case "ArrowUp":
          target = addDays(activeDate, -7);
          break;
        case "ArrowDown":
          target = addDays(activeDate, 7);
          break;
        case "Home":
          target = toIsoDate(year, monthNumber, 1);
          break;
        case "End":
          target = days[days.length - 1];
          break;
        case "PageUp":
          target = addDays(activeDate, -28);
          break;
        case "PageDown":
          target = addDays(activeDate, 28);
          break;
        case "Enter":
        case " ": {
          event.preventDefault();
          if (SELECTABLE.has(states.get(activeDate) ?? "past")) {
            onSelect(activeDate);
          }
          return;
        }
        default:
          return;
      }
      event.preventDefault();
      // Never navigate before the first bookable month.
      if (compareIsoDate(target.slice(0, 7) + "-01", `${minMonth}-01`) < 0)
        return;
      moveTo(target);
    },
    [
      activeDate,
      days,
      isRtl,
      minMonth,
      monthNumber,
      moveTo,
      onSelect,
      states,
      year,
    ],
  );

  // --- Swipe between months ------------------------------------------------
  const touch = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    touch.current = { x: point.clientX, y: point.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    // Ignore mostly-vertical gestures so page scrolling still works.
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    // A leftward swipe means "forward" in LTR and "back" in RTL.
    const forward = isRtl ? dx > 0 : dx < 0;
    if (forward) {
      onMonthChange(shiftMonth(month, 1));
    } else if (canGoBack) {
      onMonthChange(shiftMonth(month, -1));
    }
  };

  /**
   * True while the first availability response for this month is in flight.
   * Distinguished from "loaded but empty" so a slow network cannot masquerade
   * as a fully booked month.
   */
  const pending = loading && states.size === 0;

  const headers = useMemo(() => weekdayLabels(locale), [locale]);

  return (
    // calendar-bleed lets the grid reach the viewport edges on phones, which is
    // the only way 44px cells fit at 320px. See globals.css for the arithmetic.
    <div className="calendar-bleed">
      {/* Month navigation ------------------------------------------------- */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          disabled={!canGoBack}
          aria-label={t("previousMonth")}
          data-month-nav="prev"
          className={cn(
            "tap-target grid shrink-0 place-items-center rounded-full",
            "text-ink hover:bg-ink/5 transition-colors",
            "disabled:text-muted-3 disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {/* Chevron points to the inline start, so it flips with direction. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-4 rtl:rotate-180"
          >
            <path
              d="M7.5 1.5 3 6l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <h3
          className="text-ink text-[18px] font-bold"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatMonthLabel(year, monthNumber, locale)}
        </h3>

        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label={t("nextMonth")}
          data-month-nav="next"
          className={cn(
            "tap-target grid shrink-0 place-items-center rounded-full",
            "text-ink hover:bg-ink/5 transition-colors",
          )}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-4 rtl:rotate-180"
          >
            <path
              d="M4.5 1.5 9 6l-4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Grid ------------------------------------------------------------- */}
      <div
        ref={gridRef}
        role="grid"
        aria-label={t("gridLabel")}
        aria-busy={pending || undefined}
        // Lets the verification script (and any future test) wait for real data
        // instead of guessing at a delay.
        data-availability={pending ? "loading" : "loaded"}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="select-none"
      >
        <div role="row" className="calendar-grid mb-2">
          {headers.map((label, index) => (
            <div
              key={index}
              role="columnheader"
              aria-label={label}
              className="text-muted-2 grid h-7 place-items-center text-[11px] font-bold uppercase"
            >
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, weekIndex) => (
          <div role="row" key={weekIndex} className="calendar-grid mb-2">
            {week.map((date, dayIndex) => {
              if (!date) {
                return (
                  <div
                    key={`blank-${dayIndex}`}
                    role="gridcell"
                    aria-hidden="true"
                    className="min-h-11"
                  />
                );
              }

              // `pending` means availability has not arrived yet. It must NOT
              // fall back to "past": that renders every day struck through and
              // dimmed, so for the seconds the request is in flight the whole
              // month looks unbookable. A neutral placeholder is honest.
              const state = pending ? null : (states.get(date) ?? "past");
              const isSelectable = state !== null && SELECTABLE.has(state);
              const isSelected = selected === date;
              const isActive = activeDate === date;
              const dayNumber = Number(date.slice(-2));

              return (
                <div key={date} role="gridcell" aria-selected={isSelected}>
                  <button
                    type="button"
                    data-date={date}
                    data-state={state ?? "pending"}
                    // Roving tabindex: exactly one cell is tabbable.
                    tabIndex={isActive ? 0 : -1}
                    // aria-disabled, not `disabled` — see the component note.
                    aria-disabled={!isSelectable || undefined}
                    aria-label={`${formatCellLabel(date, locale)}${
                      state === null
                        ? ` — ${t("loading")}`
                        : isSelectable
                          ? ""
                          : ` — ${t(`state.${state}`)}`
                    }`}
                    onFocus={() => setPreferredActive(date)}
                    onClick={() => {
                      if (isSelectable) onSelect(date);
                    }}
                    className={cn(
                      "grid aspect-square min-h-11 w-full place-items-center",
                      "rounded-xl text-[15px] font-semibold tabular-nums",
                      "transition-[background-color,box-shadow,color]",
                      "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
                      isSelected &&
                        "bg-brand text-ink-deep shadow-cta font-bold",
                      !isSelected &&
                        isSelectable &&
                        "bg-accent/8 text-ink hover:bg-accent/20 cursor-pointer",
                      // booked and blackout share one visual language: struck
                      // through and not-allowed.
                      !isSelected &&
                        (state === "booked" || state === "blackout") &&
                        "text-muted-3 cursor-not-allowed line-through",
                      !isSelected &&
                        (state === "past" || state === "too_soon") &&
                        "text-muted-3 cursor-not-allowed opacity-45",
                      // Waiting on the API: neutral and quietly pulsing, so it
                      // reads as "loading" rather than "unavailable".
                      state === null &&
                        "bg-ink/6 text-muted-3 animate-pulse cursor-default",
                    )}
                  >
                    {dayNumber}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend ----------------------------------------------------------- */}
      <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="bg-brand size-3.5 rounded-md" />
          <span className="text-muted text-xs font-semibold">
            {t("legend.selected")}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-accent/20 size-3.5 rounded-md"
          />
          <span className="text-muted text-xs font-semibold">
            {t("legend.available")}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="bg-ink/10 size-3.5 rounded-md" />
          <span className="text-muted text-xs font-semibold line-through">
            {t("legend.booked")}
          </span>
        </li>
      </ul>
    </div>
  );
}

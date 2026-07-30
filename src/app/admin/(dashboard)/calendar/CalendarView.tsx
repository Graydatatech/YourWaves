"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatFullDate, formatTime } from "@/lib/booking/format";
import { splitIsoMonth, daysInMonth, toIsoDate } from "@/lib/dates";
import type { CalendarDay } from "@/lib/admin/types";
import { StatusPill } from "../../components/StatusPill";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { cn } from "@/lib/cn";

/**
 * The calendar, in two genuinely different shapes.
 *
 * A 7-column grid with a booking chip in each cell needs about 90px per column
 * to be legible. At 390px that is 55px, and the chips become unreadable
 * slivers — so below 900px this is an AGENDA LIST instead: only the days that
 * have something, in date order, full width. Same data, same actions, a shape
 * that fits the hand holding it.
 *
 * The month grid returns at `wide:`, where it is genuinely the better view
 * because you can see the shape of the month at once.
 */

type Props = {
  month: string;
  days: CalendarDay[];
  today: string;
};

export function CalendarView({ month, days, today }: Props) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byDate = new Map(days.map((day) => [day.date, day]));
  const { year, month: monthNumber } = splitIsoMonth(month);
  const totalDays = daysInMonth(year, monthNumber);

  const allDates = Array.from({ length: totalDays }, (_, index) =>
    toIsoDate(year, monthNumber, index + 1),
  );

  // Sunday-first, matching Qatar's working week and the customer-facing
  // calendar from phase 3. getUTCDay() on a UTC-constructed date gives the
  // weekday of the 1st without the host timezone getting a vote — the same
  // discipline §4b applies everywhere else.
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const leadingBlanks = firstWeekday;

  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const sheetDay = sheetDate ? byDate.get(sheetDate) : undefined;
  const sheetIsBlackout = Boolean(sheetDay?.blackout);

  async function toggleBlackout(date: string, isBlackout: boolean) {
    setPending(true);
    setError(null);

    const response = isBlackout
      ? await fetch(`/api/admin/blackouts?date=${date}`, { method: "DELETE" })
      : await fetch("/api/admin/blackouts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date, reason }),
        });

    setPending(false);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        detail.error === "date_has_booking"
          ? t("calendar.blackoutHasBooking")
          : t("common.error"),
      );
      return;
    }

    setSheetDate(null);
    setReason("");
    router.refresh();
  }

  const populated = days.filter(
    (day) => day.bookings.length > 0 || day.blackout,
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-ink-deep text-xl font-extrabold tracking-tight">
          {t("calendar.title")}
        </h1>
        <div className="flex items-center gap-1">
          <Link
            href={`/admin/calendar?month=${previousMonth}`}
            aria-label={t("calendar.prev")}
            className="border-border text-ink tap-target rounded-pill flex items-center justify-center border px-3"
          >
            ‹
          </Link>
          <span className="text-ink min-w-28 text-center text-sm font-bold tabular-nums">
            {monthLabel(month)}
          </span>
          <Link
            href={`/admin/calendar?month=${nextMonth}`}
            aria-label={t("calendar.next")}
            className="border-border text-ink tap-target rounded-pill flex items-center justify-center border px-3"
          >
            ›
          </Link>
        </div>
      </header>

      {/* --- Agenda: the mobile shape ------------------------------------- */}
      <section className="wide:hidden">
        {populated.length === 0 ? (
          <p className="border-border bg-surface text-muted rounded-card border p-4 text-sm">
            {t("calendar.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {populated.map((day) => (
              <li
                key={day.date}
                className="border-border bg-surface rounded-card border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-bold",
                      day.date === today ? "text-accent-strong" : "text-ink",
                    )}
                  >
                    {formatFullDate(day.date, "en")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSheetDate(day.date)}
                    className="text-muted-2 hover:text-ink tap-target px-1 text-xs font-semibold"
                  >
                    {day.blackout
                      ? t("calendar.blackoutRemove")
                      : t("calendar.blackoutAdd")}
                  </button>
                </div>

                {day.blackout ? (
                  <p className="rounded-input mt-2 bg-[#f1f5f9] px-2.5 py-1.5 text-xs font-semibold text-[#475569]">
                    {t("calendar.blackout")}
                    {day.blackout.reason ? ` · ${day.blackout.reason}` : ""}
                  </p>
                ) : null}

                <ul className="mt-2 flex flex-col gap-1.5">
                  {day.bookings.map((booking) => (
                    <li key={booking.id}>
                      <Link
                        href={`/admin/bookings/${booking.reference}`}
                        className="bg-page flex min-h-11 items-center justify-between gap-2 rounded-xl px-3"
                      >
                        <span className="min-w-0">
                          <span className="text-ink block truncate text-sm font-semibold">
                            {booking.customerName}
                          </span>
                          <span className="text-muted-2 block text-xs tabular-nums">
                            {formatTime(booking.preferredStart, "en")}
                            {booking.driverName
                              ? ` · ${booking.driverName}`
                              : ""}
                          </span>
                        </span>
                        <StatusPill status={booking.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Month grid: the desktop shape -------------------------------- */}
      <section className="border-border bg-surface rounded-card wide:block hidden border p-3">
        <div className="grid grid-cols-7 gap-1 pb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div
              key={label}
              className="text-muted-2 py-1 text-center text-xs font-bold"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <div key={`blank-${index}`} />
          ))}

          {allDates.map((date) => {
            const day = byDate.get(date);
            const isToday = date === today;

            return (
              <div
                key={date}
                className={cn(
                  "border-border min-h-24 rounded-xl border p-1.5",
                  day?.blackout && "bg-[#f8fafc]",
                  isToday && "border-accent",
                )}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={cn(
                      "text-xs font-bold tabular-nums",
                      isToday ? "text-accent-strong" : "text-muted-2",
                    )}
                  >
                    {date.slice(-2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheetDate(date)}
                    aria-label={
                      day?.blackout
                        ? t("calendar.blackoutRemove")
                        : t("calendar.blackoutAdd")
                    }
                    className="text-muted-2 hover:text-ink -m-1 p-1 text-xs leading-none"
                  >
                    {day?.blackout ? "↺" : "＋"}
                  </button>
                </div>

                {day?.blackout ? (
                  <p className="mt-1 truncate text-[10px] font-bold text-[#475569] uppercase">
                    {t("calendar.blackout")}
                  </p>
                ) : null}

                <ul className="mt-1 flex flex-col gap-1">
                  {day?.bookings.map((booking) => (
                    <li key={booking.id}>
                      <Link
                        href={`/admin/bookings/${booking.reference}`}
                        title={`${booking.customerName} · ${formatTime(booking.preferredStart, "en")}`}
                        className="block"
                      >
                        <StatusPill status={booking.status} />
                        <span className="text-ink mt-0.5 block truncate text-[11px] font-semibold">
                          {booking.customerName}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <ConfirmSheet
        open={sheetDate !== null}
        pending={pending}
        tone={sheetIsBlackout ? "default" : "danger"}
        title={
          sheetDate
            ? sheetIsBlackout
              ? t("calendar.blackoutRemove")
              : t("calendar.blackoutAdd")
            : ""
        }
        body={
          error ??
          (sheetDate
            ? `${formatFullDate(sheetDate, "en")}${
                sheetDay?.bookings.length
                  ? ` · ${sheetDay.bookings.length} booking(s)`
                  : ""
              }`
            : "")
        }
        confirmLabel={
          sheetIsBlackout
            ? t("calendar.blackoutRemove")
            : t("calendar.blackoutAdd")
        }
        onConfirm={() =>
          sheetDate && toggleBlackout(sheetDate, sheetIsBlackout)
        }
        onCancel={() => {
          setSheetDate(null);
          setReason("");
          setError(null);
        }}
      >
        {sheetDate && !sheetIsBlackout ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="blackout-reason"
              className="text-ink text-sm font-semibold"
            >
              {t("calendar.blackoutReason")}
            </label>
            <input
              id="blackout-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("calendar.blackoutReasonPlaceholder")}
              className={cn(
                "border-border bg-surface rounded-input min-h-12 border px-3.5",
                // 16px minimum: a smaller input makes iOS Safari zoom on focus.
                "focus:border-accent text-base outline-none",
              )}
            />
          </div>
        ) : null}
      </ConfirmSheet>
    </div>
  );
}

function shiftMonth(month: string, delta: number): string {
  const { year, month: monthNumber } = splitIsoMonth(month);
  const zeroBased = monthNumber - 1 + delta;
  const nextYear = year + Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const { year, month: monthNumber } = splitIsoMonth(month);
  return new Intl.DateTimeFormat("en-QA-u-nu-latn", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 12)));
}

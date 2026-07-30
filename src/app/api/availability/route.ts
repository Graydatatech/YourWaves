import { getBlackoutDates, getBookedDates, getSettings } from "@/db/queries";
import { computeAvailability } from "@/lib/availability";
import {
  datesInMonth,
  isIsoMonth,
  normaliseTime,
  qatarToday,
} from "@/lib/dates";

/**
 * GET /api/availability?month=2026-08
 *
 * Returns one entry per bookable day of the month. Days beyond
 * settings.max_advance_days are omitted entirely rather than returned with a
 * state, so the calendar cannot offer them.
 *
 * This endpoint is hit on every calendar render and every month change, so the
 * response is cached at the edge for 30s and served stale for a further 5
 * minutes while revalidating. The window is short because a date going from
 * `available` to `booked` is exactly what a customer must not miss — 30s of
 * staleness is recoverable (the hold is atomic and will reject them), 5 minutes
 * would not be.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";

  if (!isIsoMonth(month)) {
    return Response.json(
      {
        error: "invalid_month",
        message: "Expected ?month=YYYY-MM, e.g. ?month=2026-08",
      },
      { status: 400 },
    );
  }

  let settings;
  try {
    settings = await getSettings();
  } catch {
    return Response.json(
      { error: "settings_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startTimes = settings.available_start_times;
  if (startTimes.length === 0) {
    return Response.json(
      { error: "no_start_times_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Sorted so the "earliest slot" is genuinely the earliest, whatever order
  // the settings row happens to store them in.
  const earliestStartTime = [...startTimes].map(normaliseTime).sort()[0];

  const daysOfMonth = datesInMonth(month);
  const from = daysOfMonth[0];
  const to = daysOfMonth[daysOfMonth.length - 1];

  const [bookedDates, blackoutDates] = await Promise.all([
    getBookedDates(from, to),
    getBlackoutDates(from, to),
  ]);

  const now = new Date();
  const days = computeAvailability({
    month,
    now,
    leadTimeHours: settings.lead_time_hours,
    maxAdvanceDays: settings.max_advance_days,
    earliestStartTime,
    bookedDates,
    blackoutDates,
  });

  return Response.json(
    {
      month,
      timeZone: "Asia/Qatar",
      today: qatarToday(now),
      days,
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=30, stale-while-revalidate=300, max-age=0",
      },
    },
  );
}

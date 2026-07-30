import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testSql, truncateBookings, insertBooking } from "./helpers/db";
import { computeAvailability } from "@/lib/availability";
import { qatarWallClockToInstant, type IsoDate } from "@/lib/dates";

const LEAD_HOURS = 24;
const EARLIEST_SLOT = "08:00:00";

/** Builds the inputs for a month, with sensible defaults. */
function input(overrides: {
  month: string;
  now: Date;
  booked?: string[];
  blackout?: string[];
  leadTimeHours?: number;
  maxAdvanceDays?: number;
}) {
  return {
    month: overrides.month,
    now: overrides.now,
    leadTimeHours: overrides.leadTimeHours ?? LEAD_HOURS,
    maxAdvanceDays: overrides.maxAdvanceDays ?? 120,
    earliestStartTime: EARLIEST_SLOT,
    bookedDates: new Set<IsoDate>(overrides.booked ?? []),
    blackoutDates: new Set<IsoDate>(overrides.blackout ?? []),
  };
}

function stateOf(days: { date: string; state: string }[], date: string) {
  return days.find((d) => d.date === date)?.state;
}

describe("availability: lead time boundary", () => {
  // 08:00 Qatar on 14 Aug 2026, expressed as a UTC instant.
  const slot = qatarWallClockToInstant("2026-08-14", EARLIEST_SLOT);

  it("marks a date exactly on the lead-time boundary as too_soon", () => {
    // `now` is exactly LEAD_HOURS before the day's first slot.
    const now = new Date(slot.getTime() - LEAD_HOURS * 3_600_000);

    const days = computeAvailability(input({ month: "2026-08", now }));
    expect(stateOf(days, "2026-08-14")).toBe("too_soon");
  });

  it("marks the same date available one hour earlier", () => {
    // One hour further out: the notice period is genuinely exceeded.
    const now = new Date(slot.getTime() - (LEAD_HOURS + 1) * 3_600_000);

    const days = computeAvailability(input({ month: "2026-08", now }));
    expect(stateOf(days, "2026-08-14")).toBe("available");
  });

  it("is one second either side of the boundary that decides it", () => {
    const boundary = slot.getTime() - LEAD_HOURS * 3_600_000;

    const justInside = computeAvailability(
      input({ month: "2026-08", now: new Date(boundary - 1000) }),
    );
    const exactly = computeAvailability(
      input({ month: "2026-08", now: new Date(boundary) }),
    );

    expect(stateOf(justInside, "2026-08-14")).toBe("available");
    expect(stateOf(exactly, "2026-08-14")).toBe("too_soon");
  });
});

describe("availability: day states", () => {
  const now = qatarWallClockToInstant("2026-08-01", "09:00:00");

  it("marks past days as past", () => {
    const days = computeAvailability(input({ month: "2026-07", now }));
    expect(stateOf(days, "2026-07-20")).toBe("past");
  });

  it("marks booked days as booked", () => {
    const days = computeAvailability(
      input({ month: "2026-08", now, booked: ["2026-08-20"] }),
    );
    expect(stateOf(days, "2026-08-20")).toBe("booked");
  });

  it("marks blackout days as blackout", () => {
    const days = computeAvailability(
      input({ month: "2026-08", now, blackout: ["2026-08-21"] }),
    );
    expect(stateOf(days, "2026-08-21")).toBe("blackout");
  });

  it("omits days beyond max_advance_days entirely", () => {
    const days = computeAvailability(
      input({ month: "2026-08", now, maxAdvanceDays: 10 }),
    );
    // 2026-08-01 + 10 days = 2026-08-11 is the last returned day.
    expect(stateOf(days, "2026-08-11")).toBeDefined();
    expect(stateOf(days, "2026-08-12")).toBeUndefined();
  });

  it("returns today itself, not a day either side", () => {
    const days = computeAvailability(input({ month: "2026-08", now }));
    // The process TZ is Pacific/Kiritimati (UTC+14). 09:00 Qatar on 1 Aug is
    // 20:00 the same day in Kiritimati, but a naive implementation that used
    // local getters would still be at risk here; assert the Qatar answer.
    expect(stateOf(days, "2026-07-31")).toBeUndefined(); // different month
    expect(stateOf(days, "2026-08-01")).toBeDefined();
  });
});

// File-scope teardown; see the note in booking-constraints.test.ts.
afterAll(async () => {
  await testSql.end();
});

describe("availability: against the database", () => {
  beforeEach(truncateBookings);

  /** Mirrors the query in src/db/queries.ts. */
  async function bookedDates(from: string, to: string): Promise<Set<string>> {
    const rows = await testSql<{ booking_date: string }[]>`
      SELECT to_char(booking_date, 'YYYY-MM-DD') AS booking_date
        FROM active_bookings
       WHERE booking_date BETWEEN ${from}::date AND ${to}::date
    `;
    return new Set(rows.map((r) => r.booking_date));
  }

  it("treats a date with a live 'holding' booking as booked", async () => {
    await insertBooking({
      bookingDate: "2026-08-18",
      status: "holding",
      // Hold still has 9 minutes left.
      holdExpiresAt: new Date(Date.now() + 9 * 60_000),
    });

    const booked = await bookedDates("2026-08-01", "2026-08-31");
    expect(booked.has("2026-08-18")).toBe(true);

    const days = computeAvailability(
      input({
        month: "2026-08",
        now: qatarWallClockToInstant("2026-08-01", "09:00:00"),
        booked: [...booked],
      }),
    );
    expect(stateOf(days, "2026-08-18")).toBe("booked");
  });

  it("frees a date whose hold has lapsed, even before the sweeper runs", async () => {
    await insertBooking({
      bookingDate: "2026-08-19",
      status: "holding",
      // Expired 60 seconds ago; the row is still physically present.
      holdExpiresAt: new Date(Date.now() - 60_000),
    });

    const stillHolding = await testSql`
      SELECT status FROM bookings WHERE booking_date = '2026-08-19'::date
    `;
    expect(stillHolding[0].status).toBe("holding");

    const booked = await bookedDates("2026-08-01", "2026-08-31");
    expect(booked.has("2026-08-19")).toBe(false);
  });

  it("expire_stale_holds releases lapsed holds and logs an event", async () => {
    const booking = await insertBooking({
      bookingDate: "2026-08-25",
      status: "holding",
      holdExpiresAt: new Date(Date.now() - 60_000),
    });

    const [{ expire_stale_holds: released }] = await testSql<
      { expire_stale_holds: number }[]
    >`SELECT expire_stale_holds()`;
    expect(released).toBe(1);

    const [row] = await testSql<{ status: string; hold_expires_at: null }[]>`
      SELECT status, hold_expires_at FROM bookings WHERE id = ${booking.id}::uuid
    `;
    expect(row.status).toBe("expired");
    expect(row.hold_expires_at).toBeNull();

    const events = await testSql`
      SELECT to_status FROM booking_events WHERE booking_id = ${booking.id}::uuid
    `;
    expect(events.map((e) => e.to_status)).toContain("expired");
  });
});

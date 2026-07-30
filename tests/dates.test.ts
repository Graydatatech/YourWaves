import { describe, it, expect } from "vitest";
import {
  addDays,
  datesInMonth,
  differenceInDays,
  isIsoDate,
  isIsoMonth,
  normaliseTime,
  qatarDateOf,
  qatarToday,
  qatarWallClockToInstant,
} from "@/lib/dates";

/**
 * The whole suite runs under TZ=Pacific/Kiritimati (UTC+14) — see tests/setup.ts.
 * Every assertion here would fail under a naive implementation that leaned on
 * the host's local time, which is exactly the point.
 */
describe("dates: timezone independence", () => {
  it("reports the Qatar calendar day, not the host's", () => {
    // 2026-08-14 23:30 Qatar. In Kiritimati (UTC+14) that instant is already
    // 2026-08-15 10:30, so a local-time implementation would answer the 15th.
    const instant = qatarWallClockToInstant("2026-08-14", "23:30:00");
    expect(qatarDateOf(instant)).toBe("2026-08-14");
  });

  it("keeps the early hours on the correct Qatar day", () => {
    // 00:30 Qatar on the 14th is 21:30 on the 13th UTC — a UTC-based
    // implementation would answer the 13th.
    const instant = qatarWallClockToInstant("2026-08-14", "00:30:00");
    expect(qatarDateOf(instant)).toBe("2026-08-14");
    expect(instant.toISOString()).toBe("2026-08-13T21:30:00.000Z");
  });

  it("converts Qatar wall clock to the right UTC instant (UTC+3)", () => {
    const instant = qatarWallClockToInstant("2026-08-14", "08:00:00");
    expect(instant.toISOString()).toBe("2026-08-14T05:00:00.000Z");
  });

  it("qatarToday is stable across the host's midnight", () => {
    // 2026-08-14 12:00 Qatar — mid-afternoon, unambiguous everywhere.
    const noon = qatarWallClockToInstant("2026-08-14", "12:00:00");
    expect(qatarToday(noon)).toBe("2026-08-14");
  });
});

describe("dates: calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(datesInMonth("2028-02")).toHaveLength(29);
    expect(datesInMonth("2026-02")).toHaveLength(28);
  });

  it("counts whole days between dates", () => {
    expect(differenceInDays("2026-08-01", "2026-08-31")).toBe(30);
    expect(differenceInDays("2026-08-31", "2026-08-01")).toBe(-30);
  });

  it("enumerates a month in order", () => {
    const days = datesInMonth("2026-08");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-08-01");
    expect(days.at(-1)).toBe("2026-08-31");
  });
});

describe("dates: validation", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isIsoDate("2026-08-14")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-8-14")).toBe(false);
    expect(isIsoDate("14/08/2026")).toBe(false);
  });

  it("validates months", () => {
    expect(isIsoMonth("2026-08")).toBe(true);
    expect(isIsoMonth("2026-00")).toBe(false);
    expect(isIsoMonth("2026-8")).toBe(false);
  });

  it("normalises times to HH:MM:SS", () => {
    expect(normaliseTime("8:00")).toBe("08:00:00");
    expect(normaliseTime("08:00")).toBe("08:00:00");
    expect(normaliseTime("15:30:45")).toBe("15:30:45");
    expect(() => normaliseTime("25:00")).toThrow();
  });
});

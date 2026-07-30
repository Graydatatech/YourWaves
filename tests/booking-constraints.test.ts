import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testSql, truncateBookings, insertBooking } from "./helpers/db";
import { BLOCKING_STATUSES } from "@/db/schema";

/**
 * The no-double-booking guarantee.
 *
 * These tests insert directly with SQL, deliberately bypassing
 * create_booking_hold(). The whole point of SRS 3.2 is that the DATABASE
 * refuses overlapping bookings — if the guarantee lived in application code,
 * an admin tool, a migration script or a future careless query could break it.
 */
// File-scope teardown: inside a describe it would close the pool before the
// later describes in this file have run.
afterAll(async () => {
  await testSql.end();
});

describe("bookings: one booking per date", () => {
  beforeEach(truncateBookings);

  it("rejects a second blocking booking on the same date", async () => {
    await insertBooking({ bookingDate: "2026-08-14", status: "confirmed" });

    await expect(
      insertBooking({ bookingDate: "2026-08-14", status: "pending" }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("allows a cancelled booking on a date that already has a confirmed one", async () => {
    await insertBooking({ bookingDate: "2026-08-15", status: "confirmed" });

    const cancelled = await insertBooking({
      bookingDate: "2026-08-15",
      status: "cancelled",
    });

    expect(cancelled.id).toBeTruthy();
  });

  it("frees the date once the occupying booking is cancelled", async () => {
    const first = await insertBooking({
      bookingDate: "2026-08-16",
      status: "confirmed",
    });

    await testSql`
      SELECT transition_booking_status(${first.id}::uuid, 'cancelled', 'admin')
    `;

    const second = await insertBooking({
      bookingDate: "2026-08-16",
      status: "confirmed",
    });
    expect(second.id).toBeTruthy();
  });

  it("blocks the date for every status the index covers", async () => {
    // Proves the SQL index list and BLOCKING_STATUSES in the TypeScript schema
    // describe the same set — they are two copies of one decision.
    for (const [index, status] of BLOCKING_STATUSES.entries()) {
      const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
      await insertBooking({ bookingDate: date, status });
      await expect(
        insertBooking({ bookingDate: date, status: "pending" }),
      ).rejects.toMatchObject({ code: "23505" });
    }
  });

  it("does not block the date for cancelled or expired", async () => {
    await insertBooking({ bookingDate: "2026-10-01", status: "cancelled" });
    await insertBooking({ bookingDate: "2026-10-01", status: "expired" });
    const live = await insertBooking({
      bookingDate: "2026-10-01",
      status: "confirmed",
    });
    expect(live.id).toBeTruthy();
  });
});

describe("bookings: row invariants", () => {
  beforeEach(truncateBookings);

  it("requires hold_expires_at while holding", async () => {
    await expect(
      insertBooking({
        bookingDate: "2026-08-20",
        status: "holding",
        holdExpiresAt: null,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a price_total that does not add up", async () => {
    await expect(
      testSql`
        INSERT INTO bookings (
          booking_date, preferred_start, status, customer_name,
          customer_phone, address_line,
          price_rental, price_setup, price_delivery, price_total
        ) VALUES (
          '2026-08-21'::date, '08:00'::time, 'confirmed', 'T',
          '+97455000000', 'x', 450000, 60000, 35000, 1
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("generates a YW-<year>-<counter> reference", async () => {
    const booking = await insertBooking({ bookingDate: "2026-08-22" });
    expect(booking.reference).toMatch(/^YW-\d{4}-\d{4}$/);

    const second = await insertBooking({ bookingDate: "2026-08-23" });
    expect(second.reference).not.toBe(booking.reference);
  });
});

describe("booking_events: append-only", () => {
  beforeEach(truncateBookings);

  it("refuses updates and deletes", async () => {
    const booking = await insertBooking({ bookingDate: "2026-08-24" });
    await testSql`
      INSERT INTO booking_events (booking_id, to_status, actor_type)
      VALUES (${booking.id}::uuid, 'confirmed', 'system')
    `;

    await expect(
      testSql`UPDATE booking_events SET actor_type = 'admin'`,
    ).rejects.toThrow(/append-only/);

    await expect(testSql`DELETE FROM booking_events`).rejects.toThrow(
      /append-only/,
    );
  });
});

import postgres from "postgres";

/**
 * Direct connection to the TEST database.
 *
 * Deliberately does not import src/db/client.ts: that module is `server-only`
 * and memoises a pool on globalThis, neither of which suits a test process.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL (or DATABASE_URL) must be set to run database tests.",
  );
}
if (!/yourwaves_test|_test(\b|$)/.test(url)) {
  throw new Error(
    `Refusing to run destructive tests against ${url.replace(/:\/\/[^@]*@/, "://***@")}.\n` +
      "Point TEST_DATABASE_URL at a database whose name ends in _test.",
  );
}

export const testSql = postgres(url, {
  max: 4,
  ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : "require",
  onnotice: () => {},
  connection: { timezone: "UTC" },
});

/** Empties every mutable table, leaving settings and drivers from the seed. */
export async function truncateBookings(): Promise<void> {
  await testSql.unsafe(
    `TRUNCATE bookings, booking_events, payments, notifications,
              blackout_dates, otp_verifications, booking_reference_counters
     RESTART IDENTITY CASCADE`,
  );
}

/**
 * Inserts a booking directly, bypassing create_booking_hold().
 *
 * Used by the constraint tests, which must exercise the DATABASE guarantee
 * rather than the function's own checks — the point is that the partial unique
 * index holds even when application logic is circumvented entirely.
 */
export async function insertBooking(overrides: {
  bookingDate: string;
  status?: string;
  holdExpiresAt?: Date | null;
  preferredStart?: string;
}): Promise<{ id: string; reference: string }> {
  const status = overrides.status ?? "confirmed";
  // `??` would be wrong here: an explicit `null` is a deliberate instruction to
  // insert NULL (to exercise the CHECK constraint), not an absent argument.
  const holdExpiresAt =
    overrides.holdExpiresAt !== undefined
      ? overrides.holdExpiresAt
      : status === "holding"
        ? hoursFromNow(1)
        : null;

  const rows = await testSql<{ id: string; reference: string }[]>`
    INSERT INTO bookings (
      booking_date, preferred_start, status, hold_expires_at,
      customer_name, customer_phone, address_line,
      price_rental, price_setup, price_delivery, price_total
    ) VALUES (
      ${overrides.bookingDate}::date,
      ${overrides.preferredStart ?? "08:00:00"}::time,
      ${status}::booking_status,
      ${holdExpiresAt},
      'Test Customer', '+97455000000', '1 Test Street',
      450000, 60000, 35000, 545000
    )
    RETURNING id, reference
  `;
  return rows[0];
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}

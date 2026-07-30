import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testSql, truncateBookings, insertBooking } from "./helpers/db";

/**
 * Proves the deny-all posture actually denies.
 *
 * This matters because the developer machine connects as a Postgres superuser,
 * and superusers bypass RLS unconditionally — so simply querying as ourselves
 * would prove nothing. These tests create a throwaway unprivileged role,
 * deliberately GRANT it full table privileges, and then show RLS still blocks
 * it. That is the same position `anon` and `authenticated` are in on Supabase.
 *
 * If a future migration adds a permissive policy by accident, this fails.
 */
const PROBE_ROLE = "yourwaves_rls_probe";

describe("RLS: anonymous access is denied", () => {
  beforeAll(async () => {
    await truncateBookings();
    await insertBooking({ bookingDate: "2026-08-14", status: "confirmed" });

    await testSql.unsafe(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
    await testSql.unsafe(`CREATE ROLE ${PROBE_ROLE} NOLOGIN`);
    await testSql.unsafe(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    // Deliberately over-granting: the point is that RLS holds even when table
    // privileges were handed out by mistake.
    await testSql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
    );
  });

  afterAll(async () => {
    await testSql.unsafe(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`,
    );
    await testSql.unsafe(`REVOKE USAGE ON SCHEMA public FROM ${PROBE_ROLE}`);
    await testSql.unsafe(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
    await testSql.end();
  });

  it("returns no rows from bookings", async () => {
    const rows = await testSql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
      return tx`SELECT * FROM bookings`;
    });
    expect(rows).toHaveLength(0);
  });

  it("returns no rows from settings, recipients or payments", async () => {
    for (const table of ["settings", "dispatch_recipients", "payments", "notifications"]) {
      const rows = await testSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
        return tx.unsafe(`SELECT * FROM ${table}`);
      });
      expect(rows, `${table} should be invisible`).toHaveLength(0);
    }
  });

  it("refuses inserts at the reference generator (first layer)", async () => {
    // `reference` defaults to next_booking_reference(), whose EXECUTE is
    // revoked from PUBLIC. An anonymous insert is stopped here, before RLS is
    // even consulted.
    await expect(
      testSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
        return tx`
          INSERT INTO bookings (
            booking_date, preferred_start, customer_name, customer_phone,
            address_line, price_rental, price_setup, price_delivery, price_total
          ) VALUES (
            '2026-09-09'::date, '08:00'::time, 'Intruder', '+9740000000',
            'nowhere', 1, 1, 1, 3
          )
        `;
      }),
    ).rejects.toThrow(/permission denied for function/i);
  });

  it("refuses inserts at RLS even when the generator is side-stepped", async () => {
    // Supplying `reference` explicitly avoids the default expression, so this
    // insert reaches the row-level security check — the layer that actually
    // matters.
    await expect(
      testSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
        return tx`
          INSERT INTO bookings (
            reference, booking_date, preferred_start, customer_name,
            customer_phone, address_line,
            price_rental, price_setup, price_delivery, price_total
          ) VALUES (
            'YW-9999-9999', '2026-09-09'::date, '08:00'::time, 'Intruder',
            '+9740000000', 'nowhere', 1, 1, 1, 3
          )
        `;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot call the booking mutation functions", async () => {
    await expect(
      testSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${PROBE_ROLE}`);
        return tx`SELECT expire_stale_holds()`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still lets the service connection (superuser/service_role) work", async () => {
    // Sanity check that the tests above are measuring RLS, not a broken setup:
    // the same rows the probe cannot see are plainly visible to us.
    const rows = await testSql`SELECT * FROM bookings`;
    expect(rows.length).toBeGreaterThan(0);
  });
});

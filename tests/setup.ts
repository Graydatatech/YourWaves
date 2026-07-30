import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Run the whole suite in a timezone that is NOT Qatar and NOT UTC.
 *
 * Pacific/Kiritimati is UTC+14 — the furthest any zone gets from Qatar's UTC+3.
 * Under this TZ, a naive `new Date("2026-08-14")` or any accidental use of
 * local-time getters lands on a different calendar day than the intended one,
 * so the off-by-one bug this phase is designed to prevent becomes a test
 * failure rather than a production surprise.
 *
 * The developer machine used to build this happened to have Postgres itself set
 * to Asia/Qatar, which would have made TZ-dependent code pass for the wrong
 * reason. Forcing a hostile zone here removes that luck.
 */
process.env.TZ = "Pacific/Kiritimati";

/** Tests must never touch the development database. */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

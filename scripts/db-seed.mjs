/**
 * Seeds the baseline configuration and the dispatch recipients.
 *
 * Idempotent: safe to run repeatedly. Settings are upserted, recipients are keyed
 * on phone so re-running does not duplicate them.
 *
 * Usage: node scripts/db-seed.mjs
 */
import "./load-env.mjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

/**
 * Money is stored in MINOR UNITS (1 QAR = 100 dirhams).
 *
 * The brief quoted pricing as "4500/600/350 QAR", so these are those amounts
 * converted: 4500 QAR rental, 600 QAR setup, 350 QAR delivery — 5450 QAR total.
 * If the intent was instead that 4500/600/350 were already minor units (i.e.
 * QAR 45.00/6.00/3.50), drop the `* 100` here and nowhere else.
 */
const qar = (majorUnits) => majorUnits * 100;

/** The 8 bookable booking times, 08:00–15:00 Qatar, hourly. */
const START_TIMES = Array.from(
  { length: 8 },
  (_, i) => `${String(8 + i).padStart(2, "0")}:00:00`,
);

/**
 * The dispatch recipients seeded on a fresh database.
 *
 * No email: since phase 9 a recipient is reached on WhatsApp only, and the
 * column is gone. `is_default` is set for all three, so a freshly seeded
 * environment actually dispatches when a booking is paid rather than silently
 * telling nobody.
 */
/**
 * Bilingual since migration 0012. The English name is the canonical value —
 * it is what lands on the booking and what a driver reads on a job sheet.
 */
const SERVICE_AREAS = [
  { en: "Doha", ar: "الدوحة" },
  { en: "Lusail", ar: "لوسيل" },
  { en: "Al Wakrah", ar: "الوكرة" },
  { en: "Al Khor", ar: "الخور" },
  { en: "West Bay", ar: "الخليج الغربي" },
  { en: "Al Rayyan", ar: "الريان" },
];

const DRIVERS = [
  { fullName: "Yousef Al-Marri", phone: "+97455010001" },
  { fullName: "Ahmed Al-Sulaiti", phone: "+97455010002" },
  { fullName: "Rashid Al-Kuwari", phone: "+97455010003" },
];

try {
  await sql`
    INSERT INTO settings (
      id, price_rental, price_setup, price_delivery, currency,
      available_start_times, lead_time_hours, max_advance_days, hold_minutes,
      admin_notification_emails, service_areas
    ) VALUES (
      1,
      ${qar(5450)}, 0, 0, 'QAR',
      ${START_TIMES}, 24, 120, 10,
      ${["bookings@yourwaves.qa"]},
      ${JSON.stringify(SERVICE_AREAS)}::text::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      price_rental          = EXCLUDED.price_rental,
      price_setup           = EXCLUDED.price_setup,
      price_delivery        = EXCLUDED.price_delivery,
      currency              = EXCLUDED.currency,
      available_start_times = EXCLUDED.available_start_times,
      lead_time_hours       = EXCLUDED.lead_time_hours,
      max_advance_days      = EXCLUDED.max_advance_days,
      hold_minutes          = EXCLUDED.hold_minutes,
      admin_notification_emails = EXCLUDED.admin_notification_emails,
      service_areas         = EXCLUDED.service_areas
  `;
  console.log(
    `✓ settings: ${qar(5450)} minor units full-day price, ` +
      `${START_TIMES.length} start times (${START_TIMES[0]}–${START_TIMES.at(-1)}), ` +
      `${SERVICE_AREAS.length} bilingual areas`,
  );

  for (const driver of DRIVERS) {
    await sql`
      INSERT INTO dispatch_recipients (full_name, phone, role, is_default, is_active)
      SELECT ${driver.fullName}, ${driver.phone}, 'driver', true, true
      WHERE NOT EXISTS (SELECT 1 FROM dispatch_recipients WHERE phone = ${driver.phone})
    `;
  }
  const [{ count }] =
    await sql`SELECT count(*)::int AS count FROM dispatch_recipients`;
  console.log(`✓ dispatch recipients: ${count} total (auto-dispatch on)`);
} catch (error) {
  console.error("✗ Seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

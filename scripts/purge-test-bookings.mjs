/**
 * Removes every booking and its dependent rows, then resets the reference
 * counter. For clearing test data off a project before it goes live.
 *
 * IRREVERSIBLE. It asks for the database it is pointed at to be named back,
 * because "delete every booking" typed against the wrong DATABASE_URL is not a
 * mistake anything here can undo.
 *
 * `booking_events` is append-only by trigger (0000), so a cascading delete
 * raises rather than silently erasing an audit trail — that is the trigger
 * doing its job. Clearing test data is the one legitimate reason to step
 * around it, so the trigger is disabled INSIDE the transaction and restored by
 * the same transaction, meaning a failure anywhere leaves it enabled.
 *
 * Usage:
 *   node scripts/purge-test-bookings.mjs --dry-run      # show what would go
 *   node scripts/purge-test-bookings.mjs --confirm      # actually do it
 */
import "./load-env.mjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const confirmed = process.argv.includes("--confirm");
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require", onnotice: () => {} });

const target = url.replace(/:\/\/[^@]*@/, "://***@");
console.log(`\nTarget: ${target}\n`);

try {
  const [before] = await sql`
    SELECT
      (SELECT count(*)::int FROM bookings)                  AS bookings,
      (SELECT count(*)::int FROM booking_events)            AS events,
      (SELECT count(*)::int FROM payments)                  AS payments,
      (SELECT count(*)::int FROM notifications)             AS notifications,
      (SELECT count(*)::int FROM booking_notes)             AS notes,
      (SELECT count(*)::int FROM booking_dispatch)          AS dispatches,
      (SELECT count(*)::int FROM booking_dispatch_photos)   AS photos,
      (SELECT count(*)::int FROM blackout_dates)            AS blackouts
  `;
  console.log("current row counts:", JSON.stringify(before));

  if (!confirmed) {
    console.log("\nDry run — nothing deleted. Re-run with --confirm.");
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    // The append-only guard. Disabled only for the life of this transaction.
    await tx.unsafe(`ALTER TABLE booking_events DISABLE TRIGGER booking_events_no_mutation`);

    // Children first, so nothing depends on a row that has gone. Most have ON
    // DELETE CASCADE, but doing it explicitly makes the counts checkable.
    await tx`DELETE FROM booking_dispatch_photos`;
    await tx`DELETE FROM booking_dispatch_actions`;
    await tx`DELETE FROM dispatch_access_log`;
    await tx`DELETE FROM booking_dispatch`;
    await tx`DELETE FROM notifications`;
    await tx`DELETE FROM booking_notes`;
    await tx`DELETE FROM payment_events`;
    await tx`DELETE FROM payments`;
    await tx`DELETE FROM booking_events`;
    await tx`DELETE FROM bookings`;

    // Sample scheduling data seeded alongside the sample bookings.
    await tx`DELETE FROM blackout_dates`;

    // So the first real booking is YW-<year>-0001 rather than 0031.
    await tx`DELETE FROM booking_reference_counters`;

    await tx.unsafe(`ALTER TABLE booking_events ENABLE TRIGGER booking_events_no_mutation`);
  });

  const [after] = await sql`
    SELECT
      (SELECT count(*)::int FROM bookings)                  AS bookings,
      (SELECT count(*)::int FROM booking_events)            AS events,
      (SELECT count(*)::int FROM payments)                  AS payments,
      (SELECT count(*)::int FROM notifications)             AS notifications,
      (SELECT count(*)::int FROM booking_notes)             AS notes,
      (SELECT count(*)::int FROM booking_dispatch)          AS dispatches,
      (SELECT count(*)::int FROM booking_dispatch_photos)   AS photos,
      (SELECT count(*)::int FROM blackout_dates)            AS blackouts
  `;
  console.log("after:              ", JSON.stringify(after));

  // The guard must be back on, or the audit trail is quietly unprotected.
  const [guard] = await sql`
    SELECT tgenabled FROM pg_trigger
     WHERE tgname = 'booking_events_no_mutation'
       AND tgrelid = 'booking_events'::regclass
  `;
  console.log(
    `append-only trigger: ${guard?.tgenabled === "O" ? "ENABLED ✓" : `UNEXPECTED (${guard?.tgenabled})`}`,
  );

  // Kept: what the business needs to keep working.
  const [kept] = await sql`
    SELECT (SELECT count(*)::int FROM settings)             AS settings,
           (SELECT count(*)::int FROM dispatch_recipients)  AS recipients,
           (SELECT count(*)::int FROM user_roles)           AS admins
  `;
  console.log("kept:               ", JSON.stringify(kept));
} finally {
  await sql.end();
}

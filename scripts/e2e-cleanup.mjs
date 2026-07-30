/** Cancels leftover E2E bookings from an interrupted payments:e2e run. */
import d from "dotenv";
import postgres from "postgres";
d.config({ path: ".env.local", quiet: true });
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const rows = await sql`
  SELECT id, reference, booking_date::text, status::text FROM bookings
   WHERE customer_name IN ('E2E Runner','Second Runner') AND status <> 'cancelled'
`;
console.log("leftover:", rows.length ? rows : "none");
for (const row of rows) {
  // Cancel first: the status trigger enqueues cancellation messages, so a
  // delete that ran before it would leave those behind, addressed to a real
  // phone number.
  await sql`UPDATE bookings SET status='cancelled', hold_expires_at=NULL WHERE id=${row.id}::uuid`;
  await sql`DELETE FROM notifications WHERE booking_id = ${row.id}::uuid`;
  console.log(`cancelled ${row.reference} (${row.booking_date})`);
}
await sql.end();

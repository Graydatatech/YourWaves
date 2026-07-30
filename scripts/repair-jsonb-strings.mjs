/**
 * Repairs jsonb columns that hold a JSON *string* instead of an object.
 *
 * Written for the double-encoding bug found in phase 8: several call sites used
 * `${JSON.stringify(x)}::jsonb`, and postgres.js serialises the parameter itself
 * when it sees a jsonb cast, so the value was encoded twice. The affected rows
 * look populated but every key lookup returns NULL.
 *
 * Idempotent: a row already holding an object is left alone.
 *
 * Usage: node scripts/repair-jsonb-strings.mjs [--apply]
 *        (dry run by default — it reports what it would change)
 */
import d from "dotenv";
import postgres from "postgres";
d.config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const TARGETS = [
  ["payments", "raw_payload"],
  ["payment_events", "raw"],
  ["booking_events", "metadata"],
  ["settings_audit", "before"],
  ["settings_audit", "after"],
];

let total = 0;

for (const [table, column] of TARGETS) {
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM ${sql(table)}
     WHERE jsonb_typeof(${sql(column)}) = 'string'
  `;
  total += count;
  console.log(`${table}.${column}`.padEnd(28) + `${count} double-encoded`);

  if (count > 0 && apply) {
    // The stored value IS the JSON text, so one more parse recovers the object.
    // Guarded so a string that is not itself valid JSON is left untouched.
    const [{ fixed }] = await sql`
      WITH updated AS (
        UPDATE ${sql(table)}
           SET ${sql(column)} = (${sql(column)} #>> '{}')::jsonb
         WHERE jsonb_typeof(${sql(column)}) = 'string'
           AND (${sql(column)} #>> '{}') ~ '^\\s*[{\\[]'
        RETURNING 1
      )
      SELECT count(*)::int AS fixed FROM updated
    `;
    console.log(`  → repaired ${fixed}`);
  }
}

console.log(
  total === 0
    ? "\nNothing to repair."
    : apply
      ? "\nDone."
      : "\nDry run. Re-run with --apply to repair.",
);
await sql.end();

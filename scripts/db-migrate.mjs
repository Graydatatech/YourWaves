/**
 * Applies every migration in ./drizzle in order.
 *
 * Uses Drizzle's own migrator so the generated and hand-written migrations
 * share one journal and one `__drizzle_migrations` ledger — a hand-written file
 * is applied exactly once, just like a generated one.
 *
 * Usage:
 *   node scripts/db-migrate.mjs                  # uses DATABASE_URL
 *   DATABASE_URL=... node scripts/db-migrate.mjs
 */
import "./load-env.mjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

// max:1 — migrations must run on a single connection so advisory locks and
// transaction boundaries behave predictably.
const sql = postgres(url, {
  max: 1,
  ssl: isLocal ? false : "require",
  onnotice: () => {},
});

const target = url.replace(/:\/\/[^@]*@/, "://***@");
console.log(`Migrating ${target}`);

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied.");
} catch (error) {
  // Drizzle embeds the whole failing file in `message`, which buries the actual
  // Postgres error. Surface the parts that identify the problem first.
  console.error("✗ Migration failed");
  if (error.code) console.error(`  code:   ${error.code}`);
  if (error.where) console.error(`  where:  ${error.where}`);
  if (error.detail) console.error(`  detail: ${error.detail}`);
  if (error.hint) console.error(`  hint:   ${error.hint}`);
  const cause = error.cause ?? error;
  const firstLine = String(cause.message ?? "").split("\n")[0];
  console.error(`  ${firstLine}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}

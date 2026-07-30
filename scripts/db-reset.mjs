/**
 * Drops and recreates the public schema, then re-runs every migration.
 *
 * This is what proves "migrations run clean on a fresh database" — it is not a
 * truncate, it removes the schema entirely, so a migration that only works
 * against an already-migrated database will fail here.
 *
 * Usage: node scripts/db-reset.mjs
 */
import "./load-env.mjs";
import postgres from "postgres";
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (!isLocal && !process.env.ALLOW_REMOTE_RESET) {
  console.error(
    "Refusing to reset a non-local database.\n" +
      "Set ALLOW_REMOTE_RESET=1 if you are certain this is a throwaway project.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: isLocal ? false : "require" });

try {
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await sql.unsafe("CREATE SCHEMA public");
  // The migration ledger lives in its own `drizzle` schema. Dropping only
  // `public` would leave it behind, so the migrator would believe the earlier
  // migrations were still applied and run only the newest one against an empty
  // database — a silent no-op that makes a broken migration look fine.
  await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  console.log("✓ Schemas dropped (public + drizzle ledger) and recreated.");
} finally {
  await sql.end();
}

execFileSync(process.execPath, ["scripts/db-migrate.mjs"], {
  stdio: "inherit",
  env: process.env,
});

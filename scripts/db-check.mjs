/**
 * Verifies a database is correctly configured — local or Supabase.
 *
 * Run this immediately after pointing DATABASE_URL at a new project. It checks
 * the things that are easy to get wrong on a hosted Postgres and that would
 * otherwise surface as a confusing runtime failure:
 *
 *   1. the connection works at all, and which pooler it went through
 *   2. whether the connected role can actually READ the tables — the failure
 *      mode that FORCE ROW LEVEL SECURITY would have caused
 *   3. every migration has been applied
 *   4. RLS is on, and no accidental permissive policy has appeared
 *   5. the locking objects exist (partial unique index + functions)
 *   6. the seed has run
 *
 * Usage: node scripts/db-check.mjs
 */
import "./load-env.mjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
const isTransactionPooler = /:6543(\/|$|\?)/.test(url);

const sql = postgres(url, {
  max: 1,
  ssl: isLocal ? false : "require",
  prepare: !isTransactionPooler,
  connect_timeout: 15,
  onnotice: () => {},
});

const problems = [];
const warnings = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  problems.push(msg);
  console.log(`  ✗ ${msg}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  ! ${msg}`);
};

const EXPECTED_TABLES = [
  "blackout_dates",
  "booking_events",
  "booking_reference_counters",
  "bookings",
  "dispatch_recipients",
  "notifications",
  "otp_verifications",
  "payments",
  "settings",
];

const EXPECTED_FUNCTIONS = [
  "create_booking_hold",
  "expire_stale_holds",
  "next_booking_reference",
  "transition_booking_status",
];

try {
  // --- 1. Connection ------------------------------------------------------
  console.log(`\nConnection  ${url.replace(/:\/\/[^@]*@/, "://***@")}`);
  const [info] = await sql`
    SELECT current_user,
           current_database()                       AS db,
           version()                                AS version,
           inet_server_addr()::text                 AS server_addr
  `;
  ok(`connected as "${info.current_user}" to "${info.db}"`);
  console.log(`    ${info.version.split(",")[0]}`);

  const [role] = await sql`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  const bypasses = role?.rolsuper || role?.rolbypassrls;

  if (isLocal) {
    ok("local database");
  } else if (isTransactionPooler) {
    warn(
      "connected via the TRANSACTION pooler (:6543). Prepared statements are " +
        "disabled automatically, but migrations need the SESSION pooler " +
        "(:5432) — advisory locks do not survive here.",
    );
  } else {
    ok("connected via a session/direct connection (:5432)");
  }

  const [{ has_auth }] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AS has_auth
  `;
  console.log(
    `    Supabase project: ${has_auth ? "yes" : "no (plain Postgres)"}`,
  );

  // --- 2. Can the app actually read? --------------------------------------
  console.log("\nApplication access");
  const missingTables = [];
  for (const table of EXPECTED_TABLES) {
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = ${table}
      ) AS exists
    `;
    if (!exists) missingTables.push(table);
  }
  if (missingTables.length) {
    bad(
      `missing tables: ${missingTables.join(", ")} — run \`pnpm db:migrate\``,
    );
  } else {
    ok(`all ${EXPECTED_TABLES.length} tables present`);
  }

  if (!missingTables.length) {
    // The check that FORCE ROW LEVEL SECURITY would have failed.
    try {
      const rows = await sql`SELECT id FROM settings WHERE id = 1`;
      if (rows.length === 0) {
        bad(
          "the connected role can reach `settings` but sees no rows — either " +
            "the seed has not run, or RLS is filtering the owner out " +
            "(check FORCE ROW LEVEL SECURITY).",
        );
      } else {
        ok("the connected role can read application data");
      }
    } catch (error) {
      bad(`cannot read settings: ${error.message}`);
    }

    if (!bypasses && !isLocal) {
      warn(
        `role "${info.current_user}" has neither SUPERUSER nor BYPASSRLS. ` +
          "That is fine as long as it owns the tables and FORCE RLS is off " +
          "(migration 0003) — the read check above is the real test.",
      );
    }
  }

  // --- 3. Migrations ------------------------------------------------------
  console.log("\nMigrations");
  const [{ exists: hasLedger }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables
       WHERE schemaname = 'drizzle' AND tablename = '__drizzle_migrations'
    ) AS exists
  `;
  if (!hasLedger) {
    bad("no migration ledger — run `pnpm db:migrate`");
  } else {
    const applied = await sql`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
    `;
    const { readFileSync } = await import("node:fs");
    const journal = JSON.parse(
      readFileSync("./drizzle/meta/_journal.json", "utf8"),
    );
    if (applied.length === journal.entries.length) {
      ok(`${applied.length}/${journal.entries.length} migrations applied`);
    } else {
      bad(
        `${applied.length}/${journal.entries.length} migrations applied — ` +
          "run `pnpm db:migrate`",
      );
    }
  }

  // --- 4. RLS posture -----------------------------------------------------
  console.log("\nRow Level Security");
  const rlsRows = await sql`
    SELECT c.relname            AS table,
           c.relrowsecurity     AS enabled,
           c.relforcerowsecurity AS forced
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'r'
     ORDER BY c.relname
  `;
  const rlsOff = rlsRows.filter((r) => !r.enabled).map((r) => r.table);
  const forced = rlsRows.filter((r) => r.forced).map((r) => r.table);

  if (rlsRows.length === 0) {
    bad("no tables found");
  } else if (rlsOff.length) {
    bad(`RLS is OFF on: ${rlsOff.join(", ")}`);
  } else {
    ok(`RLS enabled on all ${rlsRows.length} tables`);
  }
  if (forced.length) {
    bad(
      `FORCE RLS is still on: ${forced.join(", ")} — this locks the owner out. ` +
        "Apply migration 0003_rls_owner_access.",
    );
  }

  const policies = await sql`
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public'
  `;
  if (policies.length === 0) {
    ok(
      "no policies defined (deny-all for anon/authenticated) — expected until phase 7",
    );
  } else {
    warn(
      `${policies.length} policy/policies exist: ` +
        policies.map((p) => `${p.tablename}.${p.policyname}`).join(", "),
    );
  }

  // --- 5. Locking objects -------------------------------------------------
  console.log("\nBooking integrity");
  const [{ exists: hasIndex }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'bookings_active_date_key'
    ) AS exists
  `;
  if (hasIndex) {
    ok("partial unique index bookings_active_date_key present");
  } else {
    bad("MISSING bookings_active_date_key — double bookings are possible");
  }

  const fns = await sql`
    SELECT p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(${EXPECTED_FUNCTIONS})
  `;
  const foundFns = new Set(fns.map((f) => f.proname));
  const missingFns = EXPECTED_FUNCTIONS.filter((f) => !foundFns.has(f));
  if (missingFns.length) {
    bad(`missing functions: ${missingFns.join(", ")}`);
  } else {
    ok(`all ${EXPECTED_FUNCTIONS.length} booking functions present`);
  }

  const [{ exists: hasView }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='active_bookings'
    ) AS exists
  `;
  if (hasView) {
    ok("active_bookings view present");
  } else {
    bad("missing active_bookings view");
  }

  // --- 6. Seed ------------------------------------------------------------
  console.log("\nSeed data");
  if (!missingTables.length) {
    const [settings] = await sql`
      SELECT price_rental, price_setup, price_delivery, currency,
             array_length(available_start_times, 1) AS slots
        FROM settings WHERE id = 1
    `;
    if (!settings) {
      bad("no settings row — run `pnpm db:seed`");
    } else {
      ok(
        `settings: ${settings.price_rental}/${settings.price_setup}/` +
          `${settings.price_delivery} ${settings.currency}, ${settings.slots} slots`,
      );
    }
    const [{ count: driverCount }] =
      await sql`SELECT count(*)::int AS count FROM dispatch_recipients`;
    if (driverCount > 0) {
      ok(`${driverCount} dispatch recipients`);
    } else {
      warn("no dispatch recipients — run `pnpm db:seed`");
    }
  }
} catch (error) {
  console.error(`\n✗ Check failed: ${error.message}`);
  if (/ENOTFOUND|ETIMEDOUT|ENETUNREACH/.test(error.message)) {
    console.error(
      "\n  Hostname did not resolve or was unreachable. On Supabase the direct\n" +
        "  connection (db.<ref>.supabase.co) is IPv6-only — use the SESSION\n" +
        "  POOLER string from Project Settings → Database instead.",
    );
  }
  if (/password authentication failed/i.test(error.message)) {
    console.error(
      "\n  Wrong password, or the password contains characters that must be\n" +
        "  percent-encoded in a URL (@ : / ? # [ ] are the usual culprits).",
    );
  }
  problems.push(error.message);
} finally {
  await sql.end();
}

console.log("");
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log(
  warnings.length
    ? `✓ Database is usable (${warnings.length} warning(s)).`
    : "✓ Database is correctly configured.",
);

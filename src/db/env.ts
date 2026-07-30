/**
 * Database connection resolution, shared by the app, the migration runner, the
 * seeder, the checker and the test harness.
 *
 * DATABASE_URL is the only thing that changes between a local Postgres and a
 * Supabase project — the schema, migrations and SQL functions are identical.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return url;
}

export function isLocalUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** Supabase-hosted connections require TLS; a local Postgres rarely has it. */
export function requiresTls(url: string): boolean {
  return !isLocalUrl(url);
}

/**
 * Supabase offers three ways in, and they are not interchangeable:
 *
 *   - Direct (`db.<ref>.supabase.co:5432`) — IPv6-only on the free tier, so it
 *     simply fails to resolve from many networks and from most CI runners.
 *   - Session pooler (`...pooler.supabase.com:5432`) — IPv4, one backend per
 *     connection. Supports prepared statements, advisory locks and multi-
 *     statement transactions. This is what migrations need.
 *   - Transaction pooler (`...pooler.supabase.com:6543`) — IPv4, a backend per
 *     *transaction*. Cheapest for serverless, but prepared statements are not
 *     supported and session-scoped state (advisory locks held across
 *     statements, SET LOCAL ROLE outside a transaction) does not survive.
 *
 * postgres.js pipelines prepared statements by default, which the transaction
 * pooler rejects with "prepared statement ... already exists". Detecting port
 * 6543 and disabling prepares makes both poolers work.
 */
export function isTransactionPooler(url: string): boolean {
  return /:6543(\/|$|\?)/.test(url);
}

/** Connection options shared by every postgres.js client in the project. */
export function connectionOptions(url: string) {
  return {
    ssl: requiresTls(url) ? ("require" as const) : (false as const),
    // See isTransactionPooler().
    prepare: !isTransactionPooler(url),
    // Every session speaks UTC. All Qatar-local reasoning is explicit, in SQL
    // (`at time zone 'Asia/Qatar'`) or in src/lib/dates.ts, so behaviour must
    // not depend on the server's configured timezone.
    connection: { timezone: "UTC" },
  };
}

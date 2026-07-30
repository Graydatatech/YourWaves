import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseUrl, connectionOptions } from "./env";

/**
 * Server-only database handle.
 *
 * `import "server-only"` makes it a build error to pull this into a Client
 * Component — the connection string and the privileges it carries must never
 * reach the browser. Customers are anonymous and read nothing directly; every
 * customer-facing query goes through a route handler that uses this client
 * (see drizzle/0002_rls.sql).
 *
 * Memoised on globalThis so Next's dev server does not open a new pool on every
 * hot reload.
 */
const globalForDb = globalThis as unknown as {
  __yourwavesSql?: ReturnType<typeof postgres>;
};

function createClient() {
  const url = databaseUrl();
  return postgres(url, {
    ...connectionOptions(url),
    // Route handlers are short-lived. Supabase's pooler enforces a per-project
    // client limit, and several serverless instances each holding a large pool
    // will exhaust it, so keep this small.
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export const sql = (globalForDb.__yourwavesSql ??= createClient());

export const db = drizzle(sql, { schema });

export { schema };

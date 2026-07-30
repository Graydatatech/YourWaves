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
 *
 * CREATED ON FIRST USE, NOT ON IMPORT. `next build` imports every route module
 * to collect page data, so anything evaluated at module scope runs at BUILD
 * time — and this module reads DATABASE_URL and throws without it. That turned
 * a missing build-time environment variable into a failed deployment on Vercel:
 *
 *     Error: DATABASE_URL is not set…
 *     Failed to collect page data for /api/admin/blackouts
 *
 * A build has no business needing database credentials; only a request does.
 * The proxy below keeps the `sql\`…\`` call shape and every postgres.js method
 * exactly as they were, while deferring the connection — and the env lookup —
 * until something actually queries.
 */
const globalForDb = globalThis as unknown as {
  __yourwavesSql?: ReturnType<typeof postgres>;
};

/**
 * A serverless instance must hold ONE connection, not a pool.
 *
 * The pool size is per PROCESS, and on Vercel every concurrent invocation is
 * its own process. Supabase's session pooler caps the whole project at
 * `pool_size` (15 by default), so `max: 10` meant two busy instances could
 * exhaust the project and the third got:
 *
 *     FATAL (EMAXCONNSESSION) max clients reached in session mode
 *
 * which surfaced as "This page couldn't load" on /admin/settings. One
 * connection per instance turns that ceiling into ~15 concurrent instances
 * instead of ~1.5, and costs nothing here: a Vercel function serves one request
 * at a time, so the queries within a request queue on that connection rather
 * than running in parallel — a little slower, but a page that renders beats a
 * page that 500s.
 *
 * A long-lived Node server is the opposite case: one process serves everything,
 * so it wants a real pool.
 */
const serverless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

function createClient() {
  const url = databaseUrl();
  return postgres(url, {
    ...connectionOptions(url),
    max: serverless ? 1 : 10,
    // Hand the connection back quickly when idle, so a burst of instances does
    // not sit on the project's allowance between requests.
    idle_timeout: serverless ? 5 : 20,
    connect_timeout: 10,
  });
}

function client(): ReturnType<typeof postgres> {
  return (globalForDb.__yourwavesSql ??= createClient());
}

/**
 * `apply` carries the tagged-template call, `get` carries `.begin`, `.unsafe`,
 * `.end` and friends. Methods are bound to the real client, because postgres.js
 * relies on `this` internally and an unbound `sql.begin` would lose it.
 */
export const sql = new Proxy(
  function () {} as unknown as ReturnType<typeof postgres>,
  {
    apply(_target, _thisArg, args: unknown[]) {
      return (client() as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_target, property) {
      const instance = client() as unknown as Record<string | symbol, unknown>;
      const value = instance[property];
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, property) {
      return property in (client() as unknown as object);
    },
  },
);

/**
 * The Drizzle handle, built on first touch for the same reason.
 *
 * Nothing imports it today — every query in the project is hand-written SQL
 * through `sql` — but constructing it eagerly would defeat the laziness above,
 * because drizzle reads properties off the client as it builds.
 */
const globalForDrizzle = globalThis as unknown as {
  __yourwavesDb?: ReturnType<typeof drizzle>;
};

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, property) {
    const instance = (globalForDrizzle.__yourwavesDb ??= drizzle(client(), {
      schema,
    })) as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };

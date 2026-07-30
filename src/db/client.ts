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

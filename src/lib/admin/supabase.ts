import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Auth, server side.
 *
 * Auth is the ONLY thing Supabase's SDK is used for in this project. Data still
 * goes through the postgres.js connection in src/db/client.ts — the schema,
 * the locking SQL and every guarantee from phases 2-7 live there, and routing
 * reads through PostgREST as well would mean two ways to ask the same question.
 *
 * What the SDK gives us that we would otherwise have to build: password
 * hashing and reset, TOTP enrolment and verification, session refresh, and
 * cookie handling that survives a server component render. Hand-rolling MFA is
 * not a good use of anyone's afternoon.
 */

export function supabaseAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function requireConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set " +
        "for the back office. See docs/admin-setup.md.",
    );
  }
  return { url, anonKey };
}

/**
 * A request-scoped client that reads and writes the session cookies.
 *
 * `cookies()` is a Promise in Next 16, and its write methods throw when called
 * from a Server Component (only a route handler, Server Action or proxy may set
 * a cookie). The setAll catch is not laziness: session refresh legitimately
 * happens during a render, and the refreshed cookie is written by the proxy on
 * the same request instead.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requireConfig();
  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. src/proxy.ts refreshes the session
          // on every admin request, so the cookie is still updated.
        }
      },
    },
  });
}

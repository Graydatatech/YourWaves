"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser-side Supabase client, used ONLY for authentication:
 * sign-in, TOTP enrolment and the MFA challenge.
 *
 * No application data is ever read through it. Every booking, driver and
 * setting is fetched from our own API routes, which check the session
 * server-side. That keeps one authorisation story instead of two.
 */
let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("supabase_not_configured");
  }

  client = createBrowserClient(url, anonKey);
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

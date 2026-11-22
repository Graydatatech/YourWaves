import { getSiteOpen } from "@/db/queries";

/**
 * GET /api/site-status — is the pre-launch gate standing aside?
 *
 * Exists for the proxy. The proxy runs on every route, prefetches included,
 * and the Next 16 docs are explicit that it should not query a database; it
 * also cannot import `@/db/client`, which is `server-only`. So the proxy asks
 * this route instead, at most once per 30s per instance (see siteGate.ts),
 * and only for a visitor who does not already hold the gate cookie.
 *
 * Public on purpose and harmless: the answer is one boolean that anybody can
 * learn by opening the home page. Outside the proxy matcher (`/api` is
 * excluded), so this request cannot loop back through the gate.
 *
 * `no-store`, so a cache between the proxy and here cannot hold the old answer
 * after an admin presses the button — the proxy's own 30s memo is the only
 * staleness, and it is bounded.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const open = await getSiteOpen();
  return Response.json({ open }, { headers: { "Cache-Control": "no-store" } });
}

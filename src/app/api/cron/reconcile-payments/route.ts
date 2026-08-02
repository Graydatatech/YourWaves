import { reconcilePayments } from "@/lib/payments/service";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/reconcile-payments
 *
 * Finds payments stuck in 'initiated' beyond the grace period, asks the provider
 * what really happened, and settles them. Schedule every 10-15 minutes.
 *
 * This is what makes a lost webhook a delay rather than a lost booking: a
 * customer who paid always ends up confirmed, even if the callback never arrived.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "cron_not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");

  if (provided !== expected) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const result = await reconcilePayments({
    olderThanMinutes: Number(url.searchParams.get("olderThanMinutes")) || 30,
  });

  return Response.json(
    { ok: true, ...result },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * Vercel Cron invokes a route with **GET**, not POST — and signs the request
 * with `Authorization: Bearer $CRON_SECRET` automatically whenever that
 * variable is set on the project. The POST handler above already accepts that
 * header, so the same function serves both.
 *
 * A GET that has an effect is not something to do casually, and this one is
 * only safe because of what guards it: without CRON_SECRET the endpoint
 * answers 503 and does nothing, and with it a caller must already know the
 * secret. It is not linked from anywhere, not in the sitemap, and disallowed
 * in robots.txt, so nothing crawls it into running.
 *
 * POST is kept as the primary verb for every other scheduler — Supabase
 * pg_cron + pg_net, GitHub Actions, cron-job.org — which is what you need if
 * the project is on a Vercel plan whose crons only fire once a day. This one
 * recovers payments whose webhook was lost.
 */
export const GET = POST;

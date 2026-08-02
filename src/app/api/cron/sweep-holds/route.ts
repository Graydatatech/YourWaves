import { sweepExpiredHolds } from "@/lib/booking/holds";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/sweep-holds
 *
 * HTTP fallback for the pg_cron job in drizzle/0005_booking_holds.sql, for
 * environments where pg_cron is unavailable or not schedulable (a local
 * Postgres, or a Supabase plan/role that cannot schedule).
 *
 * Schedule it every minute — Vercel Cron, GitHub Actions, or any external
 * scheduler. It is idempotent: running it twice, or not at all for an hour,
 * cannot corrupt anything. Missing it entirely never blocks a customer either,
 * because `active_bookings` already ignores lapsed holds; the sweep exists so
 * the stored rows match reality and the unique index is freed.
 *
 * Guarded by a shared secret. Without it, anyone could drive load against the
 * database by calling this in a loop.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json(
      { error: "cron_not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  // Accept either header: Vercel Cron sends Authorization, other schedulers
  // are easier to configure with a custom header.
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");

  if (provided !== expected) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const released = await sweepExpiredHolds();

  if (released > 0) {
    console.info(`[cron] released ${released} lapsed hold(s)`);
  }

  return Response.json(
    { ok: true, released },
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
 * releases lapsed holds.
 */
export const GET = POST;

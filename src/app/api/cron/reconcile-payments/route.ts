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

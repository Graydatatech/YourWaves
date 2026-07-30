import { runNotificationWorker } from "@/lib/notifications/worker";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/send-notifications
 *
 * The outbox worker's trigger. Schedule every minute (Vercel Cron, Supabase
 * pg_cron + pg_net, or any external scheduler).
 *
 * Guarded by CRON_SECRET, and 503 rather than open when it is unset — the same
 * refusal as the other two cron endpoints. An unauthenticated worker endpoint
 * would let anyone drain the queue at will, and each drained row costs real
 * money in WhatsApp template fees.
 *
 * Running it twice concurrently is safe: claiming is atomic, so the second run
 * simply finds nothing to take.
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
  const batchSize = Number(url.searchParams.get("batchSize")) || undefined;

  try {
    const result = await runNotificationWorker({ batchSize });
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // A fault in the worker itself (database down, provider misconfigured).
    // Individual send failures never reach here — they are recorded on the row.
    console.error("[cron/send-notifications] worker failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "worker_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

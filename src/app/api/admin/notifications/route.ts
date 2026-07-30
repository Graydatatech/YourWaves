import { requireAdmin } from "@/lib/admin/session";
import {
  notificationCounts,
  notificationLog,
} from "@/lib/notifications/queries";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/admin/notifications?status=failed&limit=100
 *
 * The notifications log, rendered by the booking detail screen and the
 * standalone admin view. A queue you cannot look at is a queue you find out
 * about from a customer.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam === "queued" ||
    statusParam === "sent" ||
    statusParam === "failed"
      ? statusParam
      : undefined;

  const [entries, counts] = await Promise.all([
    notificationLog({
      status,
      limit: Number(url.searchParams.get("limit")) || undefined,
    }),
    notificationCounts(),
  ]);

  return Response.json({ ok: true, counts, entries }, { headers: NO_STORE });
}

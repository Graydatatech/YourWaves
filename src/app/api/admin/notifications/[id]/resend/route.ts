import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { resendNotification } from "@/lib/notifications/queries";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * POST /api/admin/notifications/[id]/resend
 *
 * The manual override behind the "resend" button in the log.
 *
 * It requeues rather than sending inline: the worker owns delivery, so a resend
 * takes the same path, the same rendering and the same retry ladder as the
 * original. Sending from here would create a second delivery path that could
 * drift from the first, and would block the admin's request on a provider.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const entry = await resendNotification(resolved.data.id);
  if (!entry) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  console.info("[admin/notifications] requeued", {
    id: entry.id,
    templateKey: entry.templateKey,
    channel: entry.channel,
  });

  return Response.json({ ok: true, entry }, { headers: NO_STORE });
}

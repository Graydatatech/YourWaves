import { requireAdmin } from "@/lib/admin/session";
import { readPaymentsStatus } from "@/lib/payments/status";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/admin/payments — the payment configuration, minus the secrets.
 *
 * Behind `requireAdmin()` like every other admin route, and answering with a
 * STATUS rather than a redirect when refused: `fetch` follows redirects, so a
 * redirect-to-login would arrive as a 200 carrying the login page and look like
 * success to anything checking `response.ok` (see §4h).
 *
 * `readPaymentsStatus()` returns only presence flags and four-character hints —
 * no secret ever reaches this response. That is enforced at the source rather
 * than by remembering to omit fields here.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  return Response.json(
    { ok: true, status: readPaymentsStatus() },
    { headers: NO_STORE },
  );
}

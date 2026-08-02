import { requireAdmin } from "@/lib/admin/session";
import {
  readPaymentsStatus,
  testPaymentsConnection,
} from "@/lib/payments/status";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/admin/payments/test — prove the credentials work.
 *
 * Creates a QAR 1.00 checkout at the provider and discards it. Nothing is
 * written to our database: no booking, no hold, no payment row. A failed test
 * therefore cannot leave a half-built booking behind, and a successful one
 * cannot occupy a date.
 *
 * POST rather than GET because it has an effect on the provider's side, and a
 * GET would be pre-fetched by a browser, retried by a proxy, and triggered by
 * anything that crawls the admin — none of which should be able to create
 * payments.
 *
 * ON PRODUCTION IT REQUIRES `{ "confirm": true }`. The test costs nothing (no
 * money moves unless somebody pays the link) but it does put a line in the
 * merchant's real ledger, and a button that quietly writes to a live payment
 * account is not one anybody should press by accident while exploring a
 * settings screen. The sandbox has no such gate — that is what a sandbox is
 * for, and a confirmation step there would only train people to click through
 * it.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const status = readPaymentsStatus();

  if (status.environment === "production" && !status.isMock) {
    const body = (await request.json().catch(() => ({}))) as {
      confirm?: unknown;
    };

    if (body.confirm !== true) {
      return Response.json(
        {
          ok: false,
          error: "confirmation_required",
          message:
            "This is the PRODUCTION gateway. The test creates a real QAR 1.00 " +
            "payment record in the merchant account. No money moves unless " +
            "someone pays it, but it will appear in the ledger. Confirm to " +
            "continue.",
        },
        { status: 409, headers: NO_STORE },
      );
    }
  }

  const result = await testPaymentsConnection();

  /**
   * Always HTTP 200 when the test itself RAN — a failed connection is a valid
   * answer to "does this work", not a fault in this endpoint. The UI reads
   * `result.ok`. Returning 4xx/5xx for a rejected credential would make the
   * client's error handling fire for what is a successful diagnostic.
   */
  return Response.json({ ok: true, result }, { headers: NO_STORE });
}

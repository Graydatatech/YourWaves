import { createPaymentProvider } from "@/lib/payments";
import { settleEvent } from "@/lib/payments/service";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/payments/webhook — the source of truth.
 *
 * This is the only thing that confirms a booking. The customer's browser
 * redirect does not, because a URL is forgeable.
 *
 * Order is load-bearing:
 *   1. read the body as TEXT. Signatures are computed over exact bytes;
 *      parsing and re-serialising JSON changes them.
 *   2. verify the signature. An unsigned or wrongly-signed call gets 401 and is
 *      never parsed for meaning.
 *   3. only then settle, through SQL that is idempotent by unique constraint.
 *
 * Always answers 200 once a signed event has been recorded, including for
 * duplicates and unknown payments. A provider that receives a 4xx/5xx retries,
 * and retrying will not fix an event we have already handled or cannot match —
 * it just fills their queue. Genuine faults still return 500 so the retry is
 * useful.
 */
export async function POST(request: Request) {
  const provider = createPaymentProvider();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json(
      { error: "unreadable_body" },
      { status: 400, headers: NO_STORE },
    );
  }

  const verification = await provider.verifyWebhook({
    rawBody,
    headers: request.headers,
  });

  if (!verification.valid) {
    // Deliberately terse, and the raw body is NOT logged: an unverified payload
    // is attacker-controlled and could contain anything, including card-shaped
    // data planted to get it written to our logs.
    console.warn("[payments/webhook] rejected", {
      provider: provider.name,
      reason: verification.reason,
    });
    return Response.json(
      { error: "invalid_signature" },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const result = await settleEvent(provider.name, verification.event);

    console.info("[payments/webhook] settled", {
      provider: provider.name,
      providerRef: verification.event.providerRef,
      status: verification.event.status,
      outcome: result.outcome,
      reference: result.reference,
    });

    return Response.json(
      { ok: true, outcome: result.outcome },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // A real fault: let the provider retry.
    console.error("[payments/webhook] settlement failed", {
      provider: provider.name,
      providerRef: verification.event.providerRef,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "settlement_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

import { MockProvider, signMockWebhook } from "@/lib/payments";

/**
 * Stand-in for the provider's hosted checkout page. DEVELOPMENT ONLY.
 *
 * Returns a minimal HTML page with a pay and a fail button. Each posts a
 * correctly SIGNED webhook to /api/payments/webhook, so the full production path
 * — signature verification, idempotency, transactional settlement — is exercised
 * locally. A mock that called the settlement functions directly would leave the
 * most security-relevant code in this phase untested.
 *
 * 404s in production: an endpoint that can confirm bookings for free must not
 * exist on a deployed site.
 */
/**
 * POST /api/payments/mock-checkout?ref=…&status=paid — simulates a LOST WEBHOOK.
 * DEVELOPMENT ONLY, 404s in production alongside the GET.
 *
 * Moves the money on the provider's side WITHOUT calling our webhook, which is
 * the one situation the webhook path can never produce on its own: the customer
 * paid, the callback vanished, and our database still says 'initiated'.
 *
 * That state is what the reconciliation job and the success page's fetchStatus
 * fallback exist for, so without this there is no way to prove either of them
 * actually recovers a booking rather than merely running without error.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const ref = url.searchParams.get("ref");
  const status = url.searchParams.get("status") ?? "paid";

  if (!ref) {
    return Response.json({ error: "ref_required" }, { status: 400 });
  }
  if (!["paid", "failed", "cancelled", "pending"].includes(status)) {
    return Response.json({ error: "bad_status" }, { status: 400 });
  }

  MockProvider.setStatus(ref, status as "paid");

  return Response.json(
    { ok: true, ref, providerReportsStatus: status, webhookSent: false },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") ?? "";
  const amount = Number(url.searchParams.get("amount") ?? "0");
  const currency = url.searchParams.get("currency") ?? "QAR";
  const returnUrl = url.searchParams.get("returnUrl") ?? "/";
  const webhookUrl = `${url.origin}/api/payments/webhook`;

  // Signed here, server-side, because the secret must not reach the browser.
  const paidBody = JSON.stringify({
    eventId: `${ref}:paid`,
    providerRef: ref,
    status: "paid",
    amount,
    currency,
  });
  const failedBody = JSON.stringify({
    eventId: `${ref}:failed`,
    providerRef: ref,
    status: "failed",
    amount,
    currency,
  });

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock checkout — YourWaves</title>
<style>
  :root { color-scheme: light }
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100dvh;
         display: grid; place-items: center; background: #eef5f9; padding: 24px }
  .card { background: #fff; border-radius: 20px; padding: 28px; max-width: 420px;
          width: 100%; box-shadow: 0 12px 34px rgba(11,42,61,.08) }
  h1 { font-size: 20px; margin: 0 0 4px }
  .warn { background: #fff7ed; border: 1px dashed #f59e0b; color: #92400e;
          padding: 10px 12px; border-radius: 12px; font-size: 13px; margin: 16px 0 }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px;
       font-size: 14px; margin: 16px 0 }
  dt { color: #4a6577 } dd { margin: 0; font-weight: 700 }
  button { width: 100%; min-height: 52px; border-radius: 999px; border: 0;
           font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 10px }
  .pay { background: linear-gradient(135deg,#22e0d6,#34c8ff); color: #04141f }
  .fail { background: #fff; border: 1px solid rgba(11,42,61,.15); color: #0b2a3d }
  #status { margin-top: 14px; font-size: 14px; min-height: 20px; font-weight: 600 }
</style>
</head>
<body>
  <div class="card">
    <h1>Mock checkout</h1>
    <p style="margin:0;color:#4a6577;font-size:14px">No real payment provider is configured.</p>
    <div class="warn">Development only. This page does not exist in production.</div>
    <dl>
      <dt>Amount</dt><dd>${(amount / 100).toFixed(2)} ${currency}</dd>
      <dt>Reference</dt><dd style="word-break:break-all;font-size:12px">${ref}</dd>
    </dl>
    <button class="pay" data-kind="paid">Pay ${(amount / 100).toFixed(2)} ${currency}</button>
    <button class="fail" data-kind="failed">Simulate a declined card</button>
    <p id="status"></p>
  </div>
<script>
  const bodies = {
    paid:   { body: ${JSON.stringify(paidBody)},   sig: ${JSON.stringify(signMockWebhook(paidBody))} },
    failed: { body: ${JSON.stringify(failedBody)}, sig: ${JSON.stringify(signMockWebhook(failedBody))} }
  };
  const status = document.getElementById('status');
  for (const button of document.querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      const kind = button.dataset.kind;
      status.textContent = 'Sending webhook…';
      try {
        const response = await fetch(${JSON.stringify(webhookUrl)}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mock-signature': bodies[kind].sig },
          body: bodies[kind].body
        });
        const json = await response.json().catch(() => ({}));
        status.textContent = 'Webhook ' + response.status + ' — ' + (json.outcome || json.error || '');
        // Same-tab redirect, as the real flow does.
        setTimeout(() => {
          location.href = kind === 'paid'
            ? ${JSON.stringify(returnUrl)}
            : ${JSON.stringify(returnUrl.replace("/success/", "/failed/"))};
        }, 700);
      } catch (error) {
        status.textContent = 'Failed: ' + error.message;
      }
    });
  }
</script>
</body>
</html>`;

  return new Response(page, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

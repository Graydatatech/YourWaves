/**
 * SkipCash sandbox diagnostics.
 *
 * The provider implementation is unverified against a live sandbox (see
 * docs/payments-setup.md). This exercises it directly and prints the exact
 * string that was signed, which is the one thing needed to compare against
 * SkipCash's documentation when authentication fails.
 *
 *   node scripts/payments-probe.mjs config
 *   node scripts/payments-probe.mjs checkout
 *   node scripts/payments-probe.mjs status <providerRef>
 */
import "./load-env.mjs";
import { createHmac } from "node:crypto";

const [command, argument] = process.argv.slice(2);

const cfg = {
  apiUrl: (process.env.SKIPCASH_API_URL ?? "").replace(/\/+$/, ""),
  clientId: process.env.SKIPCASH_CLIENT_ID ?? "",
  keyId: process.env.SKIPCASH_KEY_ID ?? "",
  secretKey: process.env.SKIPCASH_SECRET_KEY ?? "",
  webhookSecret: process.env.SKIPCASH_WEBHOOK_SECRET ?? "",
};

function requireConfig() {
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(
      ([k]) => `SKIPCASH_${k.replace(/[A-Z]/g, (m) => "_" + m).toUpperCase()}`,
    );
  if (missing.length) {
    console.error(`\n✗ Missing config: ${missing.join(", ")}`);
    console.error("  See docs/payments-setup.md.");
    process.exit(1);
  }
}

function config() {
  console.log("SkipCash configuration (presence only, no secrets printed)");
  for (const [key, value] of Object.entries(cfg)) {
    console.log(
      `  ${key.padEnd(14)} ${value ? `set (${value.length} chars)` : "MISSING"}`,
    );
  }
  console.log(
    `  provider       ${process.env.PAYMENT_PROVIDER ?? "(default: mock)"}`,
  );
}

async function checkout() {
  requireConfig();
  const reference = `YW-PROBE-${Date.now().toString().slice(-4)}`;
  const fields = [
    ["Uid", "00000000-0000-0000-0000-000000000001"],
    ["KeyId", cfg.keyId],
    ["Amount", "1.00"],
    ["FirstName", "Probe"],
    ["LastName", "Test"],
    ["Phone", "+97455000000"],
    ["Email", "probe@example.com"],
    ["street", ""],
    ["city", ""],
    ["state", ""],
    ["country", "QA"],
    ["postalCode", ""],
    ["TransactionId", reference],
    ["Custom1", reference],
  ];
  const canonical = fields.map(([k, v]) => `${k}=${v}`).join(",");
  const signature = createHmac("sha256", cfg.secretKey)
    .update(canonical, "utf8")
    .digest("base64");

  console.log("\nSigned string (compare this against SkipCash's docs):");
  console.log(`  ${canonical}`);

  const response = await fetch(`${cfg.apiUrl}/api/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: cfg.clientId,
      Signature: signature,
    },
    body: JSON.stringify({
      ...Object.fromEntries(fields),
      ReturnUrl: "https://example.com/return",
      Lang: "en",
    }),
  });

  const body = await response.json().catch(() => ({}));
  console.log(`\nHTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 1).slice(0, 1200));

  if (response.ok && body?.resultObj?.payUrl) {
    console.log(`\n  ✓ payUrl: ${body.resultObj.payUrl}`);
    console.log(`  ✓ providerRef: ${body.resultObj.id}`);
  } else {
    console.log(
      "\n  ✗ No payUrl. If this is an auth error the signed-string format above\n" +
        "    is the first thing to check against the current API docs.",
    );
    process.exitCode = 1;
  }
}

async function status() {
  requireConfig();
  if (!argument) {
    console.error(
      "Pass a provider reference: node scripts/payments-probe.mjs status <ref>",
    );
    process.exit(1);
  }
  const response = await fetch(
    `${cfg.apiUrl}/api/v1/payments/${encodeURIComponent(argument)}`,
    { headers: { Authorization: cfg.clientId } },
  );
  console.log(`HTTP ${response.status}`);
  console.log(
    JSON.stringify(await response.json().catch(() => ({})), null, 1).slice(
      0,
      1200,
    ),
  );
}

switch (command) {
  case "config":
    config();
    break;
  case "checkout":
    await checkout();
    break;
  case "status":
    await status();
    break;
  default:
    console.log(
      [
        "SkipCash sandbox diagnostics",
        "",
        "  node scripts/payments-probe.mjs config             show what is configured",
        "  node scripts/payments-probe.mjs checkout           create a QAR 1.00 sandbox checkout",
        "  node scripts/payments-probe.mjs status <ref>       read a transaction back",
      ].join("\n"),
    );
}

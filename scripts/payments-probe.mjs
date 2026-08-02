/**
 * SkipCash sandbox diagnostics.
 *
 * Mirrors src/lib/payments/skipcash.ts exactly, standalone, so a wire-format
 * problem can be diagnosed without a running app or a database. It prints the
 * literal string it signed, which is the one thing worth comparing against
 * https://dev.skipcash.app when authentication fails.
 *
 *   node scripts/payments-probe.mjs config
 *   node scripts/payments-probe.mjs checkout
 *   node scripts/payments-probe.mjs status <providerRef>
 *   node scripts/payments-probe.mjs webhook <paymentId> <amount> <statusId>
 *
 * Everything here targets the SANDBOX by default. Point SKIPCASH_API_URL at
 * https://api.skipcash.app only when you mean it — `checkout` creates a real
 * QAR 1.00 payment there.
 */
import "./load-env.mjs";
import { createHmac, randomUUID } from "node:crypto";

const [command, ...args] = process.argv.slice(2);

const SANDBOX_URL = "https://skipcashtest.azurewebsites.net";
const PRODUCTION_URL = "https://api.skipcash.app";

const cfg = {
  apiUrl: (process.env.SKIPCASH_API_URL ?? "").replace(/\/+$/, ""),
  clientId: process.env.SKIPCASH_CLIENT_ID ?? "",
  keyId: process.env.SKIPCASH_KEY_ID ?? "",
  secretKey: process.env.SKIPCASH_SECRET_KEY ?? "",
  webhookSecret: process.env.SKIPCASH_WEBHOOK_SECRET ?? "",
};

const ENV_NAME = {
  apiUrl: "SKIPCASH_API_URL",
  clientId: "SKIPCASH_CLIENT_ID",
  keyId: "SKIPCASH_KEY_ID",
  secretKey: "SKIPCASH_SECRET_KEY",
  webhookSecret: "SKIPCASH_WEBHOOK_SECRET",
};

/** `Key=Value,Key=Value`. Order and CASE are both part of the message. */
function canonical(fields) {
  return fields.map(([key, value]) => `${key}=${value}`).join(",");
}

function sign(fields, secret) {
  return createHmac("sha256", secret)
    .update(canonical(fields), "utf8")
    .digest("base64");
}

function requireConfig(keys) {
  const missing = keys.filter((key) => !cfg[key]).map((key) => ENV_NAME[key]);
  if (missing.length > 0) {
    console.error(`\n✗ Missing config: ${missing.join(", ")}`);
    console.error("  See docs/payments-setup.md.");
    process.exit(1);
  }
}

function config() {
  console.log("SkipCash configuration (presence only, no secrets printed)\n");
  for (const [key, value] of Object.entries(cfg)) {
    const shown =
      key === "apiUrl"
        ? value || "MISSING"
        : value
          ? `set (${value.length} chars)`
          : "MISSING";
    console.log(`  ${ENV_NAME[key].padEnd(24)} ${shown}`);
  }
  console.log(
    `  ${"PAYMENT_PROVIDER".padEnd(24)} ${process.env.PAYMENT_PROVIDER ?? "(default: mock)"}`,
  );

  if (cfg.apiUrl === SANDBOX_URL) {
    console.log("\n  → SANDBOX. `checkout` is safe to run.");
  } else if (cfg.apiUrl === PRODUCTION_URL) {
    console.log(
      "\n  ⚠ PRODUCTION. `checkout` would create a REAL QAR 1.00 payment.",
    );
  } else if (cfg.apiUrl) {
    console.log(
      `\n  ? Unrecognised host. Expected one of:\n` +
        `      sandbox     ${SANDBOX_URL}\n` +
        `      production  ${PRODUCTION_URL}`,
    );
  }

  if (
    cfg.secretKey &&
    cfg.webhookSecret &&
    cfg.secretKey === cfg.webhookSecret
  ) {
    console.log(
      "\n  ⚠ SKIPCASH_SECRET_KEY and SKIPCASH_WEBHOOK_SECRET are identical.\n" +
        "    They are DIFFERENT values in the merchant portal — the webhook key\n" +
        "    is issued separately. If this is a copy-paste, every inbound\n" +
        "    webhook is rejected as a forgery and bookings only ever confirm\n" +
        "    via the reconcile cron, minutes late.",
    );
  }
}

async function checkout() {
  requireConfig(["apiUrl", "keyId", "secretKey"]);

  const reference = `YW-PROBE-${Date.now().toString().slice(-6)}`;

  // Documented order AND casing — dev.skipcash.app/doc/api-integration/nodejs/
  const fields = [
    ["Uid", randomUUID()],
    ["KeyId", cfg.keyId],
    ["Amount", "1.00"],
    ["FirstName", "Probe"],
    ["LastName", "Test"],
    ["Phone", "+97455000000"],
    ["Email", "probe@example.com"],
    ["Street", ""],
    ["City", ""],
    ["State", ""],
    ["Country", "QA"],
    ["PostalCode", ""],
    ["TransactionId", reference],
    ["Custom1", reference],
  ];

  console.log("\nSigned string (compare against dev.skipcash.app):");
  console.log(`  ${canonical(fields)}`);
  console.log(`\nPOST ${cfg.apiUrl}/api/v1/payments`);

  const response = await fetch(`${cfg.apiUrl}/api/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The hash IS the Authorization header. No Signature header, no clientId.
      Authorization: sign(fields, cfg.secretKey),
    },
    body: JSON.stringify({
      ...Object.fromEntries(fields),
      // Unsigned extras: SkipCash hashes its own fixed field list, not the body.
      ReturnUrl: "https://example.com/return",
      Lang: "en",
    }),
  });

  const body = await response.json().catch(() => ({}));
  console.log(`\nHTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 1).slice(0, 1500));

  if (response.ok && body?.resultObj?.payUrl) {
    console.log(`\n  ✓ payUrl      ${body.resultObj.payUrl}`);
    console.log(`  ✓ providerRef ${body.resultObj.id}`);
    console.log(
      `\n  Open the payUrl, pay with a sandbox card, then read it back:\n` +
        `    node scripts/payments-probe.mjs status ${body.resultObj.id}`,
    );
  } else {
    console.log(
      "\n  ✗ No payUrl.\n" +
        "    401/403 → the signed string above does not match what SkipCash\n" +
        "      rebuilt. Check field ORDER and CASE first (Country, not country),\n" +
        "      then that SKIPCASH_SECRET_KEY is the payment key and not the\n" +
        "      webhook key.\n" +
        "    400     → a field SkipCash rejected; `errorMessage` above says which.",
    );
    process.exitCode = 1;
  }
}

/**
 * Tries several canonical-string constructions against the sandbox and reports
 * which one SkipCash accepts.
 *
 * "Signature does not match!" is a single error covering a large space of
 * possible causes, and SkipCash tells you nothing about which. The alternative
 * to this is one deploy per hypothesis, which is a very slow way to answer a
 * question that is really just "which fields does their end hash".
 *
 * The variants are not guesses in the dark — each corresponds to a documented
 * example that presumably works for somebody:
 *
 *   as-app        every documented field, empties included, plus the unsigned
 *                 ReturnUrl/Lang in the body. What src/lib/payments/skipcash.ts
 *                 currently sends, and what the Node.js guide shows.
 *   no-extras     the same, but with NOTHING unsigned in the body. Isolates the
 *                 possibility that their rebuild hashes the whole body rather
 *                 than a fixed field list.
 *   non-empty     only fields with a value, signed and sent. If their rebuild
 *                 skips empty values, ours must too — our string would say
 *                 "Street=,City=" where theirs says nothing at all.
 *   php-subset    exactly the eight fields the PHP guide signs, address fields
 *                 and Custom1 omitted entirely.
 *
 * Each run creates a QAR 1.00 sandbox payment that nobody pays. Harmless there;
 * do not point this at production.
 */
async function variants() {
  requireConfig(["apiUrl", "keyId", "secretKey"]);

  if (cfg.apiUrl === PRODUCTION_URL) {
    console.error(
      "\n✗ Refusing to run variants against PRODUCTION — this creates several\n" +
        "  real payment records. Point SKIPCASH_API_URL at the sandbox.",
    );
    process.exit(1);
  }

  const base = (reference) => [
    ["Uid", randomUUID()],
    ["KeyId", cfg.keyId],
    ["Amount", "1.00"],
    ["FirstName", "Probe"],
    ["LastName", "Test"],
    ["Phone", "+97455000000"],
    ["Email", "probe@example.com"],
    ["Street", ""],
    ["City", ""],
    ["State", ""],
    ["Country", "QA"],
    ["PostalCode", ""],
    ["TransactionId", reference],
    ["Custom1", reference],
  ];

  const PHP_KEYS = new Set([
    "Uid", "KeyId", "Amount", "FirstName", "LastName", "Phone", "Email",
    "TransactionId",
  ]);

  const shapes = [
    {
      name: "as-app",
      note: "all fields incl. empties, + unsigned ReturnUrl/Lang",
      build: (f) => ({
        signed: f,
        body: {
          ...Object.fromEntries(f),
          ReturnUrl: "https://example.com/return",
          Lang: "en",
        },
      }),
    },
    {
      name: "no-extras",
      note: "all fields incl. empties, body === signed fields exactly",
      build: (f) => ({ signed: f, body: Object.fromEntries(f) }),
    },
    {
      name: "non-empty",
      note: "empty fields omitted from BOTH signature and body",
      build: (f) => {
        const kept = f.filter(([, v]) => v !== "");
        return { signed: kept, body: Object.fromEntries(kept) };
      },
    },
    {
      name: "php-subset",
      note: "only the eight fields the PHP guide signs",
      build: (f) => {
        const kept = f.filter(([k]) => PHP_KEYS.has(k));
        return { signed: kept, body: Object.fromEntries(kept) };
      },
    },
  ];

  console.log(`\nTrying ${shapes.length} signature shapes against ${cfg.apiUrl}\n`);

  let winner = null;

  for (const shape of shapes) {
    const reference = `YW-VAR-${Date.now().toString().slice(-6)}`;
    const { signed, body } = shape.build(base(reference));
    const signature = sign(signed, cfg.secretKey);

    let status = "—";
    let message = "";
    try {
      const response = await fetch(`${cfg.apiUrl}/api/v1/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: signature,
        },
        body: JSON.stringify(body),
      });
      status = String(response.status);
      const parsed = await response.json().catch(() => ({}));
      if (response.ok && parsed?.resultObj?.payUrl) {
        message = "✓ ACCEPTED";
        winner = { shape, payUrl: parsed.resultObj.payUrl, id: parsed.resultObj.id };
      } else {
        message = parsed?.errorMessage ?? JSON.stringify(parsed).slice(0, 90);
      }
    } catch (error) {
      message = `request failed: ${error.message}`;
    }

    console.log(`  ${shape.name.padEnd(12)} HTTP ${status.padEnd(4)} ${message}`);
    console.log(`  ${"".padEnd(12)} ${shape.note}`);
    console.log(`  ${"".padEnd(12)} signed: ${canonical(signed).slice(0, 150)}`);
    console.log();

    if (winner) break;
  }

  if (winner) {
    console.log(
      `✓ "${winner.shape.name}" is the shape SkipCash accepts.\n` +
        `  payUrl      ${winner.payUrl}\n` +
        `  providerRef ${winner.id}\n\n` +
        `  If that is not "as-app", src/lib/payments/skipcash.ts needs to build\n` +
        `  its field list the same way.`,
    );
  } else {
    console.log(
      "✗ None of the shapes was accepted.\n\n" +
        "  That points away from the field list and at the KEY itself. Check\n" +
        "  SKIPCASH_SECRET_KEY is the payment key rather than the webhook key,\n" +
        "  that it is complete (no truncation, no stray newline from a paste),\n" +
        "  and that SKIPCASH_KEY_ID belongs to the same merchant account.",
    );
    process.exitCode = 1;
  }
}

async function status() {
  requireConfig(["apiUrl", "clientId"]);
  const [providerRef] = args;
  if (!providerRef) {
    console.error("Usage: node scripts/payments-probe.mjs status <providerRef>");
    process.exit(1);
  }

  const response = await fetch(
    `${cfg.apiUrl}/api/v1/payments/${encodeURIComponent(providerRef)}`,
    // GET authenticates with the CLIENT ID, not a signature. Confirmed against
    // dev.skipcash.app/doc/api-integration/python/ ("Put client id in the
    // header"). The asymmetry with POST is real, not a mistake.
    { headers: { Authorization: cfg.clientId } },
  );

  const body = await response.json().catch(() => ({}));
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 1).slice(0, 1500));

  const statusId = body?.resultObj?.statusId;
  if (statusId !== undefined) {
    const NAMES = {
      0: "new",
      1: "pending",
      2: "paid",
      3: "canceled",
      4: "failed",
      5: "rejected",
      6: "refunded",
      7: "pending refund",
      8: "refund failed",
      12: "customer started payment process",
    };
    console.log(
      `\n  statusId ${statusId} → ${NAMES[statusId] ?? "UNKNOWN — check the docs"}`,
    );
  }
}

/**
 * Computes the Authorization hash SkipCash would send for a given callback, so
 * a webhook can be replayed against a local server without waiting for a real
 * one — and, more usefully, so the canonical string can be eyeballed.
 *
 * This is a diagnostic, not a bypass: it needs SKIPCASH_WEBHOOK_SECRET, which
 * is the same thing that makes a genuine webhook genuine.
 */
function webhook() {
  requireConfig(["webhookSecret"]);
  const [paymentId, amount, statusId, transactionId, custom1, visaId] = args;

  if (!paymentId || !amount || !statusId) {
    console.error(
      "Usage: node scripts/payments-probe.mjs webhook <paymentId> <amount> <statusId> [transactionId] [custom1] [visaId]\n" +
        "  e.g. node scripts/payments-probe.mjs webhook abc-123 1.00 2 YW-2026-0001 YW-2026-0001",
    );
    process.exit(1);
  }

  // Documented order. Optional fields are included ONLY if present — sending
  // an empty `TransactionId=` for a field SkipCash never sent changes the hash.
  const pairs = [
    ["PaymentId", paymentId],
    ["Amount", amount],
    ["StatusId", statusId],
    ["TransactionId", transactionId],
    ["Custom1", custom1],
    ["VisaId", visaId],
  ].filter(([, value]) => value !== undefined && value !== "");

  const body = Object.fromEntries(pairs);
  const signature = sign(pairs, cfg.webhookSecret);

  console.log("\nSigned string:");
  console.log(`  ${canonical(pairs)}`);
  console.log("\nAuthorization:");
  console.log(`  ${signature}`);
  console.log("\nReplay it:");
  console.log(
    `  curl -i http://localhost:3000/api/payments/webhook \\\n` +
      `    -H 'Content-Type: application/json' \\\n` +
      `    -H 'Authorization: ${signature}' \\\n` +
      `    -d '${JSON.stringify(body)}'`,
  );
}

switch (command) {
  case "config":
    config();
    break;
  case "checkout":
    await checkout();
    break;
  case "variants":
    await variants();
    break;
  case "status":
    await status();
    break;
  case "webhook":
    webhook();
    break;
  default:
    console.log(
      [
        "SkipCash sandbox diagnostics",
        "",
        "  config                              show what is configured",
        "  checkout                            create a QAR 1.00 sandbox checkout",
        "  variants                            try each signature shape, report which",
        "                                      one SkipCash accepts (sandbox only)",
        "  status <providerRef>                read a payment back",
        "  webhook <paymentId> <amount> <statusId> [transactionId] [custom1] [visaId]",
        "                                      compute a callback signature and",
        "                                      print a curl that replays it",
        "",
        `  sandbox     ${SANDBOX_URL}`,
        `  production  ${PRODUCTION_URL}`,
      ].join("\n"),
    );
}

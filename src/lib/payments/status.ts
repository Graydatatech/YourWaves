import "server-only";

import { randomUUID } from "node:crypto";
import { createPaymentProvider } from "./index";
import { PaymentProviderError } from "./provider";

/**
 * A read-only view of the payment configuration, for the back office.
 *
 * WHY THIS IS READ-ONLY, AND WHY THE CREDENTIALS ARE NOT EDITABLE HERE.
 *
 * Everything else on the settings screen — pricing, lead time, service areas,
 * dispatch recipients — lives in the `settings` table and is edited from the
 * browser. These do not, deliberately.
 *
 * `SKIPCASH_SECRET_KEY` signs requests that move money and
 * `SKIPCASH_WEBHOOK_SECRET` is the only thing standing between a stranger and a
 * confirmed booking. Today they exist solely in the deployment environment. Put
 * them in Postgres and a database compromise stops being "customer data leaked"
 * and becomes "payments can be created and webhooks forged as us" — and this
 * application connects as the table OWNER, which migration 0003 exempted from
 * RLS, so the row policies would not contain it.
 *
 * Encrypting them at rest would answer that, but the encryption key has to live
 * in the environment regardless, so it trades five environment secrets for one
 * and adds a key-management problem. The thing the office actually needed was
 * not editing — it was VISIBILITY: is payment configured, is it pointed at the
 * sandbox or at production, and does it work right now. That is what this
 * provides, without moving a single secret into the database.
 *
 * If self-service rotation is ever genuinely needed, the shape to build is
 * encrypted-at-rest with a `SETTINGS_ENC_KEY`, not plain columns.
 */

const SANDBOX_HOST = "skipcashtest.azurewebsites.net";
const PRODUCTION_HOST = "api.skipcash.app";

export type CredentialState = {
  name: string;
  /** Present and non-empty. */
  configured: boolean;
  /**
   * Last four characters, for confirming WHICH value is installed without
   * disclosing it. Four characters of a 40-character base64 secret is not a
   * meaningful reduction in entropy, and it is the difference between "a key is
   * set" and "the key I just rotated to is set" — which is the actual question
   * someone has when they open this screen.
   */
  hint: string | null;
};

export type PaymentsStatus = {
  /** The provider the app will actually use on the next checkout. */
  provider: string;
  /** True when the mock is active — no real money can move. */
  isMock: boolean;
  environment: "sandbox" | "production" | "unknown" | "not_configured";
  apiUrl: string | null;
  credentials: CredentialState[];
  /** URL to register in the SkipCash merchant portal. */
  webhookUrl: string | null;
  /**
   * Problems that do not need a network call to find. Each is phrased as what
   * to do, because the person reading it is not the person who wrote the code.
   */
  warnings: string[];
  /** True when the configuration is complete enough to attempt a checkout. */
  ready: boolean;
};

/** Last four characters, or null when there is nothing to hint at. */
function hint(value: string | undefined): string | null {
  if (!value || value.length < 4) return null;
  return value.slice(-4);
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export function readPaymentsStatus(): PaymentsStatus {
  const provider = (process.env.PAYMENT_PROVIDER ?? "mock").toLowerCase();
  const isMock = provider !== "skipcash";

  const apiUrl = process.env.SKIPCASH_API_URL?.replace(/\/+$/, "") || null;
  const clientId = process.env.SKIPCASH_CLIENT_ID;
  const keyId = process.env.SKIPCASH_KEY_ID;
  const secretKey = process.env.SKIPCASH_SECRET_KEY;
  const webhookSecret = process.env.SKIPCASH_WEBHOOK_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || null;

  const environment: PaymentsStatus["environment"] = !apiUrl
    ? "not_configured"
    : apiUrl.includes(SANDBOX_HOST)
      ? "sandbox"
      : apiUrl.includes(PRODUCTION_HOST)
        ? "production"
        : "unknown";

  const credentials: CredentialState[] = [
    { name: "SKIPCASH_CLIENT_ID", configured: present(clientId), hint: hint(clientId) },
    { name: "SKIPCASH_KEY_ID", configured: present(keyId), hint: hint(keyId) },
    { name: "SKIPCASH_SECRET_KEY", configured: present(secretKey), hint: hint(secretKey) },
    {
      name: "SKIPCASH_WEBHOOK_SECRET",
      configured: present(webhookSecret),
      hint: hint(webhookSecret),
    },
  ];

  const warnings: string[] = [];

  if (isMock) {
    warnings.push(
      "The mock provider is active. Bookings confirm without any money moving. " +
        "Set PAYMENT_PROVIDER=skipcash to take real payments — the app refuses " +
        "to start with the mock in a production build, so this can only be a " +
        "non-production deployment.",
    );
  }

  if (!isMock) {
    const missing = credentials.filter((c) => !c.configured).map((c) => c.name);
    if (missing.length > 0) {
      warnings.push(`Missing: ${missing.join(", ")}. Checkout will fail.`);
    }

    /**
     * The single most likely misconfiguration, and the one that hides itself.
     * SkipCash issues the webhook key separately from the payment secret. Set
     * them to the same value and checkout keeps working while every callback is
     * rejected as a forgery — so bookings still confirm, but only when the
     * reconcile cron catches them, minutes late. It reads as "sometimes slow"
     * rather than as a fault.
     */
    if (
      present(secretKey) &&
      present(webhookSecret) &&
      secretKey === webhookSecret
    ) {
      warnings.push(
        "SKIPCASH_SECRET_KEY and SKIPCASH_WEBHOOK_SECRET are the same value. " +
          "They are issued separately in the merchant portal. Every incoming " +
          "webhook is being rejected, and bookings are only confirming via the " +
          "reconciliation job.",
      );
    }

    if (environment === "unknown") {
      warnings.push(
        `SKIPCASH_API_URL (${apiUrl}) is neither the sandbox nor the production ` +
          `host. Expected ${SANDBOX_HOST} or ${PRODUCTION_HOST}.`,
      );
    }

    if (environment === "sandbox") {
      warnings.push(
        "Pointed at the SANDBOX. Real cards will not be charged. Switch " +
          "SKIPCASH_API_URL to the production host before launch.",
      );
    }
  }

  if (!siteUrl) {
    warnings.push(
      "NEXT_PUBLIC_SITE_URL is not set, so the webhook URL below is a guess. " +
        "The value registered in the SkipCash portal must be the real origin.",
    );
  }

  return {
    provider,
    isMock,
    environment,
    apiUrl,
    credentials,
    webhookUrl: siteUrl ? `${siteUrl}/api/payments/webhook` : null,
    warnings,
    ready: isMock || credentials.every((c) => c.configured),
  };
}

export type PaymentsTestResult = {
  ok: boolean;
  /** Short machine-readable outcome, for the UI to branch on. */
  outcome:
    | "ok"
    | "not_ready"
    | "auth_rejected"
    | "unreachable"
    | "provider_error";
  /** One sentence, written for an operator rather than a developer. */
  message: string;
  /** The hosted payment URL, when one came back. Proof it really worked. */
  redirectUrl?: string;
  /** Provider-side id of the test payment, for looking it up in their portal. */
  providerRef?: string;
};

/**
 * Creates a QAR 1.00 checkout to prove the credentials work end to end.
 *
 * NOTHING IS WRITTEN TO OUR DATABASE. No booking, no hold, no payment row — it
 * calls the provider directly and throws the result away. That is what makes it
 * safe to press: a failed test cannot leave a half-built booking behind, and a
 * successful one cannot occupy a date.
 *
 * On the provider's side it does create a payment record, which then sits
 * unpaid and expires. On the sandbox that is free and expected. On PRODUCTION
 * it puts a QAR 1.00 line in the merchant's real ledger — no money moves unless
 * somebody actually pays it, but the route requires an explicit acknowledgement
 * there rather than treating the two environments the same.
 */
export async function testPaymentsConnection(): Promise<PaymentsTestResult> {
  const status = readPaymentsStatus();

  if (!status.ready) {
    return {
      ok: false,
      outcome: "not_ready",
      message:
        "Not all credentials are set, so there is nothing to test yet. " +
        "Fill in the missing environment variables and redeploy.",
    };
  }

  let provider;
  try {
    provider = createPaymentProvider();
  } catch (error) {
    return {
      ok: false,
      outcome: "provider_error",
      message: error instanceof Error ? error.message : "Provider unavailable.",
    };
  }

  const stamp = Date.now().toString().slice(-6);
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "http://localhost:3000";

  try {
    const result = await provider.createCheckout({
      // A real UUID: SkipCash's `Uid` is a uuid field. Random rather than
      // fixed, so repeated tests do not collide on their side.
      bookingId: randomUUID(),
      reference: `YW-TEST-${stamp}`,
      amount: 100, // minor units — QAR 1.00
      currency: "QAR",
      customer: {
        name: "Connection Test",
        phone: "+97455000000",
        email: "test@example.com",
      },
      // Nobody is expected to follow this — the test proves the gateway
      // ACCEPTED the request, and stops there. It still has to be a real
      // absolute URL, because SkipCash validates it.
      returnUrl: `${origin}/admin/settings`,
      locale: "en",
    });

    return {
      ok: true,
      outcome: "ok",
      message: status.isMock
        ? "The mock provider responded. This proves the wiring, not the SkipCash credentials — no real gateway was contacted."
        : `SkipCash accepted a QAR 1.00 test payment on the ${status.environment}. Credentials are correct.`,
      redirectUrl: result.redirectUrl,
      providerRef: result.providerRef,
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      /**
       * The provider throws `skipcash_checkout_failed_<status>`. 401/403 is
       * almost always the signature, and it is worth saying so — SkipCash
       * returns a bare status with no explanation, and the next person to debug
       * this will otherwise start by suspecting the network.
       */
      const authRejected = /_(401|403)$/.test(error.message);
      return {
        ok: false,
        outcome: authRejected
          ? "auth_rejected"
          : error.message.includes("unreachable")
            ? "unreachable"
            : "provider_error",
        message: authRejected
          ? "SkipCash rejected the credentials. Check that SKIPCASH_SECRET_KEY is the payment key (not the webhook key) and that SKIPCASH_KEY_ID matches the same merchant account. Run `pnpm payments:probe checkout` to see the exact string being signed."
          : error.message.includes("unreachable")
            ? "Could not reach SkipCash. This is a network or DNS problem, not a credentials problem."
            : `SkipCash returned an error: ${error.message}`,
      };
    }

    return {
      ok: false,
      outcome: "provider_error",
      message: "The test failed for an unexpected reason. Check the server logs.",
    };
  }
}

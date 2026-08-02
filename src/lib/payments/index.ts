import "server-only";

import type { PaymentProvider } from "./provider";
import { MockProvider } from "./mock";
import { SkipCashProvider } from "./skipcash";

export * from "./provider";
export { MockProvider, signMockWebhook } from "./mock";
export { SkipCashProvider, fromDecimalString } from "./skipcash";

/**
 * Selects the provider from the environment.
 *
 * PAYMENT_PROVIDER = "skipcash" | "mock"
 *
 * Defaults to `mock` so a fresh checkout runs with no merchant account — but
 * `mock` in production is a hard error, exactly as with the OTP console channel.
 * A deployment that took no money while reporting confirmed bookings would look
 * like it was working.
 */
let cached: PaymentProvider | null = null;

export function createPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const isProduction = process.env.NODE_ENV === "production";
  /**
   * TRIMMED, not just lowercased.
   *
   * These values are pasted into a dashboard by a human, and a trailing space
   * survives that journey far more often than anyone expects. Without the trim,
   * `"skipcash "` fails the comparison below and reports itself as "the mock is
   * active" — an error that describes a variable nobody set, and sends the
   * reader looking for the wrong thing entirely.
   */
  const raw = process.env.PAYMENT_PROVIDER;
  const requested = (raw ?? "mock").trim().toLowerCase();

  if (requested === "skipcash") {
    const apiUrl = process.env.SKIPCASH_API_URL;
    const clientId = process.env.SKIPCASH_CLIENT_ID;
    const keyId = process.env.SKIPCASH_KEY_ID;
    const secretKey = process.env.SKIPCASH_SECRET_KEY;
    const webhookSecret = process.env.SKIPCASH_WEBHOOK_SECRET;

    const missing = [
      !apiUrl && "SKIPCASH_API_URL",
      !clientId && "SKIPCASH_CLIENT_ID",
      !keyId && "SKIPCASH_KEY_ID",
      !secretKey && "SKIPCASH_SECRET_KEY",
      !webhookSecret && "SKIPCASH_WEBHOOK_SECRET",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `PAYMENT_PROVIDER=skipcash but missing: ${missing.join(", ")}. ` +
          "See docs/payments-setup.md.",
      );
    }

    cached = new SkipCashProvider({
      apiUrl: apiUrl!.replace(/\/+$/, ""),
      clientId: clientId!,
      keyId: keyId!,
      secretKey: secretKey!,
      webhookSecret: webhookSecret!,
    });
    return cached;
  }

  if (isProduction) {
    /**
     * Say what was actually seen. The original message named the rule and not
     * the input, so "unset", "mock", and a typo were indistinguishable — and
     * the commonest cause by far is the variable simply not being scoped to
     * this environment in the dashboard, which reads identically to unset.
     *
     * Quoted so a stray space is visible, and it is safe to print: this
     * variable names a provider, it is not a credential.
     */
    const seen =
      raw === undefined ? "not set" : `${JSON.stringify(raw)} (unrecognised)`;

    throw new Error(
      `PAYMENT_PROVIDER must be a real provider in production — it is ${seen}. ` +
        "The mock takes no money and would confirm bookings for free. " +
        "Expected 'skipcash'. If you have set it, check it is scoped to this " +
        "environment in the deployment settings AND that the project has been " +
        "redeployed since — environment changes do not apply to a build that " +
        "already exists.",
    );
  }

  cached = new MockProvider();
  return cached;
}

/** Test seam. */
export function resetPaymentProvider(): void {
  cached = null;
}

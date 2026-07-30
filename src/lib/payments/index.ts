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
  const requested = (process.env.PAYMENT_PROVIDER ?? "mock").toLowerCase();

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
    throw new Error(
      "PAYMENT_PROVIDER must be a real provider in production. The mock takes " +
        "no money and would confirm bookings for free.",
    );
  }

  cached = new MockProvider();
  return cached;
}

/** Test seam. */
export function resetPaymentProvider(): void {
  cached = null;
}

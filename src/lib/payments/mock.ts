import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  redactSensitive,
  type CheckoutInput,
  type CheckoutResult,
  type PaymentProvider,
  type PaymentStatus,
  type WebhookVerification,
} from "./provider";

/**
 * Local-development and test provider.
 *
 * Rather than a stub that always succeeds, this models the parts that matter:
 *   - it issues a real provider reference
 *   - it redirects to a local page that can trigger success OR failure
 *   - its webhook is SIGNED, with the same verify-before-parse discipline as
 *     SkipCash, so the signature path is exercised in tests instead of being
 *     bypassed by a provider that trusts everything
 *
 * A mock that skipped signature verification would let the most
 * security-relevant code in this phase ship untested.
 */

const MOCK_SECRET_FALLBACK = "mock-payment-secret-for-local-development-only";

function mockSecret(): string {
  return process.env.MOCK_PAYMENT_SECRET ?? MOCK_SECRET_FALLBACK;
}

/** Exposed so tests and the dev pay page can sign a webhook the way a provider would. */
export function signMockWebhook(rawBody: string): string {
  return createHmac("sha256", mockSecret())
    .update(rawBody, "utf8")
    .digest("base64");
}

type MockBody = {
  eventId?: string;
  providerRef?: string;
  status?: string;
  amount?: number;
  currency?: string;
};

export class MockProvider implements PaymentProvider {
  readonly name = "mock";

  /** In-memory status, so fetchStatus has something truthful to report. */
  private static statuses = new Map<string, PaymentStatus>();

  static setStatus(providerRef: string, status: PaymentStatus) {
    MockProvider.statuses.set(providerRef, status);
  }

  static reset() {
    MockProvider.statuses.clear();
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const providerRef = `mock_${randomUUID()}`;
    MockProvider.statuses.set(providerRef, "pending");

    // A local page that stands in for the hosted checkout. It offers a pay and a
    // fail button, each of which posts a properly signed webhook.
    const url = new URL(input.returnUrl);
    const redirect = new URL("/api/payments/mock-checkout", url.origin);
    redirect.searchParams.set("ref", providerRef);
    redirect.searchParams.set("amount", String(input.amount));
    redirect.searchParams.set("currency", input.currency);
    redirect.searchParams.set("returnUrl", input.returnUrl);
    redirect.searchParams.set("locale", input.locale);

    return { providerRef, redirectUrl: redirect.toString() };
  }

  async verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookVerification> {
    const provided = input.headers.get("x-mock-signature");
    if (!provided) return { valid: false, reason: "missing_signature" };

    const expected = signMockWebhook(input.rawBody);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: "bad_signature" };
    }

    let body: MockBody;
    try {
      body = JSON.parse(input.rawBody) as MockBody;
    } catch {
      return { valid: false, reason: "malformed_body" };
    }

    if (!body.providerRef)
      return { valid: false, reason: "missing_payment_id" };

    const status = (body.status ?? "paid") as PaymentStatus;
    MockProvider.statuses.set(body.providerRef, status);

    return {
      valid: true,
      event: {
        eventId: body.eventId ?? `${body.providerRef}:${status}`,
        providerRef: body.providerRef,
        status,
        amount: body.amount,
        currency: body.currency,
        raw: redactSensitive(body),
      },
    };
  }

  async fetchStatus(providerRef: string): Promise<PaymentStatus> {
    return MockProvider.statuses.get(providerRef) ?? "unknown";
  }
}

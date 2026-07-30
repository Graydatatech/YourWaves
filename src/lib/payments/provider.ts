import "server-only";

/**
 * The payment boundary.
 *
 * Everything the booking flow knows about payment is this interface. Swapping
 * SkipCash for MyFatoorah or Stripe means writing one new implementation and
 * changing one env var — no booking, hold or settlement logic moves.
 *
 * Money is ALWAYS an integer in minor units, matching the rest of the project.
 * Providers vary (SkipCash takes a decimal string, Stripe takes minor units), so
 * each implementation converts at its own edge and nowhere else.
 */

export type Money = {
  /** Minor units. 545000 = QAR 5,450.00 */
  amount: number;
  currency: string;
};

export type CheckoutInput = Money & {
  bookingId: string;
  reference: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  /** Absolute URL the provider sends the customer back to. */
  returnUrl: string;
  locale: "ar" | "en";
};

export type CheckoutResult = {
  /** The provider's identifier for this attempt. Stored on the payment row. */
  providerRef: string;
  /** Hosted page to send the customer to. */
  redirectUrl: string;
};

/** Normalised across providers. */
export type PaymentStatus =
  "pending" | "paid" | "failed" | "cancelled" | "refunded" | "unknown";

export type PaymentEvent = {
  /**
   * Stable, provider-side identifier for THIS event. The idempotency key.
   * If a provider gives no event id, use the transaction id plus the status so a
   * genuine state change is still distinguishable from a retry.
   */
  eventId: string;
  providerRef: string;
  status: PaymentStatus;
  /** Minor units, when the provider reports it. Used only to flag mismatches. */
  amount?: number;
  currency?: string;
  /** Verbatim body, minus anything card-shaped. Stored for disputes. */
  raw: unknown;
};

export type WebhookVerification =
  { valid: true; event: PaymentEvent } | { valid: false; reason: string };

export interface PaymentProvider {
  readonly name: string;

  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;

  /**
   * Verifies authenticity and THEN parses.
   *
   * Takes the raw body text, not a parsed object: signatures are computed over
   * exact bytes, and re-serialising JSON changes them. The route reads the body
   * once as text and hands it here.
   */
  verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookVerification>;

  fetchStatus(providerRef: string): Promise<PaymentStatus>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/**
 * Strips anything that could be a card detail before a payload is persisted or
 * logged.
 *
 * A compliant provider never posts a PAN or CVV to a webhook, but "never log the
 * raw callback body with card fields" is not a promise to make on someone else's
 * behalf. This is applied to every payload on the way in, so a provider change
 * cannot quietly introduce card data into our database or logs.
 */
const SENSITIVE_KEY =
  /(^|_)(pan|card(_?number)?|cvv|cvc|cvn|security_?code|expiry|exp_?month|exp_?year|track\d?)($|_)/i;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    // A bare 13-19 digit run is a PAN whatever the key is called.
    if (
      typeof item === "string" &&
      /^\d{13,19}$/.test(item.replace(/[\s-]/g, ""))
    ) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactSensitive(item, depth + 1);
  }
  return output;
}

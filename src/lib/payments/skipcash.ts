import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PaymentProviderError,
  redactSensitive,
  type CheckoutInput,
  type CheckoutResult,
  type PaymentProvider,
  type PaymentStatus,
  type WebhookVerification,
} from "./provider";

/**
 * SkipCash — the Qatari gateway named in the SRS.
 *
 * ⚠️ UNVERIFIED AGAINST A LIVE SANDBOX. No merchant account exists for this
 * project yet (onboarding is the client's responsibility — see
 * docs/payments-setup.md), so the request shape and signature scheme below are
 * written from SkipCash's published integration pattern and have NOT been
 * exercised against their servers.
 *
 * The two things most likely to need adjusting are marked ADJUST-ON-SANDBOX:
 * the exact ordered field list used for the request signature, and the field
 * names on the webhook body. Both are isolated here so correcting them touches
 * nothing else. `pnpm payments:probe` (scripts/payments-probe.mjs) exists to
 * check them against the sandbox as soon as credentials exist.
 *
 * What is NOT guesswork, and is what actually protects the money:
 *   - the webhook signature is verified before the body is parsed
 *   - the comparison is timing-safe
 *   - an unsigned or wrongly-signed call is rejected outright
 *   - no card data is ever accepted, stored or logged
 */

export type SkipCashConfig = {
  /** https://skipcashtest.azurewebsites.net for sandbox. */
  apiUrl: string;
  clientId: string;
  keyId: string;
  /** Signs outbound requests. */
  secretKey: string;
  /** Verifies inbound webhooks. */
  webhookSecret: string;
};

type SkipCashPayResponse = {
  resultObj?: {
    id?: string;
    payUrl?: string;
    status?: number | string;
    statusId?: number | string;
    amount?: string | number;
    currency?: string;
    transactionId?: string;
  };
  returnCode?: number;
  errorMessage?: string;
};

/**
 * SkipCash numeric status ids.
 * ADJUST-ON-SANDBOX: confirm against the current docs; the mapping matters more
 * than the numbers, so anything unrecognised deliberately becomes "unknown"
 * rather than being optimistically read as paid.
 */
function mapStatus(raw: unknown): PaymentStatus {
  const value = String(raw ?? "").toLowerCase();
  switch (value) {
    case "2":
    case "paid":
    case "success":
    case "succeeded":
      return "paid";
    case "1":
    case "new":
    case "pending":
    case "inprogress":
      return "pending";
    case "3":
    case "failed":
    case "rejected":
      return "failed";
    case "4":
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "5":
    case "refunded":
      return "refunded";
    default:
      return "unknown";
  }
}

/** Minor units → the decimal string SkipCash expects ("5450.00"). */
function toDecimalString(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

/** Decimal string → minor units, without floating-point drift. */
export function fromDecimalString(value: string | number): number {
  const text = String(value).trim();
  const [whole, fraction = ""] = text.split(".");
  const cents = (fraction + "00").slice(0, 2);
  return Number(whole) * 100 + Number(cents);
}

export class SkipCashProvider implements PaymentProvider {
  readonly name = "skipcash";

  constructor(private readonly config: SkipCashConfig) {}

  /**
   * SkipCash signs the request with an HMAC over a canonical, ORDER-SENSITIVE
   * list of the fields being sent.
   *
   * ADJUST-ON-SANDBOX: the field order is the part most likely to differ. A
   * wrong order produces a generic auth failure, which is why
   * `pnpm payments:probe` prints the exact string it signed.
   */
  private sign(fields: Array<[string, string]>): string {
    const canonical = fields.map(([k, v]) => `${k}=${v}`).join(",");
    return createHmac("sha256", this.config.secretKey)
      .update(canonical, "utf8")
      .digest("base64");
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // Split a single name field into the first/last SkipCash wants.
    const parts = input.customer.name.trim().split(/\s+/);
    const firstName = parts[0] ?? "Customer";
    const lastName = parts.slice(1).join(" ") || firstName;

    // Order matters for the signature; the body is built from the same list so
    // the two can never disagree.
    const fields: Array<[string, string]> = [
      ["Uid", input.bookingId],
      ["KeyId", this.config.keyId],
      ["Amount", toDecimalString(input.amount)],
      ["FirstName", firstName],
      ["LastName", lastName],
      ["Phone", input.customer.phone],
      ["Email", input.customer.email ?? ""],
      ["street", ""],
      ["city", ""],
      ["state", ""],
      ["country", "QA"],
      ["postalCode", ""],
      ["TransactionId", input.reference],
      ["Custom1", input.reference],
    ];

    const body = Object.fromEntries(fields);

    let response: Response;
    try {
      response = await fetch(`${this.config.apiUrl}/api/v1/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.config.clientId,
          Signature: this.sign(fields),
        },
        body: JSON.stringify({
          ...body,
          // The provider redirects here when the customer is done. It is NOT
          // what confirms the booking — the webhook is.
          ReturnUrl: input.returnUrl,
          Lang: input.locale === "ar" ? "ar" : "en",
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new PaymentProviderError("skipcash_unreachable", true, cause);
    }

    const parsed = (await response
      .json()
      .catch(() => ({}))) as SkipCashPayResponse;

    if (!response.ok || !parsed.resultObj?.payUrl || !parsed.resultObj?.id) {
      // Log diagnostics, never the signature or the secret.
      console.error("[payments/skipcash] createCheckout failed", {
        status: response.status,
        returnCode: parsed.returnCode,
        errorMessage: parsed.errorMessage,
      });
      throw new PaymentProviderError(
        `skipcash_checkout_failed_${response.status}`,
        response.status >= 500,
      );
    }

    return {
      providerRef: parsed.resultObj.id,
      redirectUrl: parsed.resultObj.payUrl,
    };
  }

  /**
   * Verifies the webhook signature BEFORE the body is parsed.
   *
   * The HMAC is computed over the raw bytes, so the body must not be
   * round-tripped through JSON first. An unsigned call is rejected: treating a
   * missing signature as acceptable would mean anyone who knows a transaction id
   * can confirm a booking for free.
   */
  async verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookVerification> {
    const provided =
      input.headers.get("signature") ??
      input.headers.get("x-signature") ??
      input.headers.get("authorization");

    if (!provided) return { valid: false, reason: "missing_signature" };

    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(input.rawBody, "utf8")
      .digest("base64");

    const a = Buffer.from(provided.replace(/^Bearer\s+/i, "").trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: "bad_signature" };
    }

    // Only now is it safe to look at the content.
    let body: SkipCashPayResponse["resultObj"] & Record<string, unknown>;
    try {
      const parsedBody = JSON.parse(input.rawBody) as Record<string, unknown>;
      body = (parsedBody.resultObj ?? parsedBody) as typeof body;
    } catch {
      return { valid: false, reason: "malformed_body" };
    }

    // ADJUST-ON-SANDBOX: field names on the callback body.
    const providerRef = String(body.id ?? body.paymentId ?? "");
    const statusRaw = body.statusId ?? body.status;
    if (!providerRef) return { valid: false, reason: "missing_payment_id" };

    const status = mapStatus(statusRaw);

    return {
      valid: true,
      event: {
        // SkipCash sends no separate event id, so the idempotency key is the
        // payment plus its status. A retry of the same state collapses; a real
        // transition (pending → paid) is still processed.
        eventId: `${providerRef}:${status}`,
        providerRef,
        status,
        amount:
          body.amount !== undefined
            ? fromDecimalString(body.amount as string | number)
            : undefined,
        currency: typeof body.currency === "string" ? body.currency : undefined,
        raw: redactSensitive(body),
      },
    };
  }

  async fetchStatus(providerRef: string): Promise<PaymentStatus> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.apiUrl}/api/v1/payments/${encodeURIComponent(providerRef)}`,
        {
          headers: { Authorization: this.config.clientId },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (cause) {
      throw new PaymentProviderError("skipcash_unreachable", true, cause);
    }

    if (!response.ok) {
      throw new PaymentProviderError(
        `skipcash_status_failed_${response.status}`,
        response.status >= 500,
      );
    }

    const parsed = (await response
      .json()
      .catch(() => ({}))) as SkipCashPayResponse;
    return mapStatus(parsed.resultObj?.statusId ?? parsed.resultObj?.status);
  }
}

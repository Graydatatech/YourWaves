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
 * WRITTEN AGAINST THE PUBLISHED SPEC at https://dev.skipcash.app —
 * `/doc/api-integration/nodejs/` for checkout and `/doc/web-hooks/` for the
 * callback. The previous version of this file was written from the general
 * integration pattern before those pages had been read, and it was wrong in
 * four ways that would each have broken the flow completely:
 *
 *   1. it sent `Authorization: <clientId>` and a separate `Signature` header.
 *      SkipCash puts THE HASH ITSELF in Authorization and has no Signature
 *      header. Every checkout would have been rejected.
 *   2. it signed `street`/`city`/`state`/`country`/`postalCode` in lower case.
 *      The canonical string is literal text, so PascalCase is load-bearing —
 *      the hash would never have matched.
 *   3. it verified the webhook by hashing the RAW BODY. SkipCash hashes a
 *      canonical field list, exactly like the outbound request. Every genuine
 *      webhook would have been rejected as a forgery.
 *   4. its status codes had `canceled` and `failed` swapped, read 5 as
 *      "refunded" when 5 is "rejected", and had no mapping for the real
 *      refund code (6).
 *
 * ⚠️ STILL NOT EXERCISED AGAINST A LIVE SANDBOX — no merchant credentials
 * exist yet (onboarding is the client's, see docs/payments-setup.md). It now
 * matches the documentation rather than a guess at it, which is a different
 * kind of unverified, but it is still unverified. `pnpm payments:probe`
 * prints the exact string it signs.
 *
 * What protects the money, unchanged:
 *   - the signature is checked before anything is ACTED on or logged
 *   - the comparison is timing-safe
 *   - an unsigned or wrongly-signed call is rejected outright
 *   - no card data is ever accepted, stored or logged
 */

export type SkipCashConfig = {
  /**
   * Sandbox:    https://skipcashtest.azurewebsites.net
   * Production: https://api.skipcash.app
   */
  apiUrl: string;
  /**
   * Merchant client id.
   *
   * NOTE: not actually sent on the checkout call — SkipCash authenticates that
   * with the HMAC alone. It is kept in the config because the merchant portal
   * issues it alongside the others and a future endpoint may want it; dropping
   * it from the required set would just mean rediscovering it later.
   */
  clientId: string;
  keyId: string;
  /** Signs outbound payment-creation requests. */
  secretKey: string;
  /**
   * Verifies inbound webhooks. A SEPARATE value from `secretKey` — the docs
   * are explicit: "use the webhook key (find in merchant portal account) to
   * encrypt the received data". Signing webhooks with the payment secret is
   * the obvious wrong guess and fails closed, so it presents as "every webhook
   * is a forgery".
   */
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
 * SkipCash `statusId`, verbatim from https://dev.skipcash.app/doc/web-hooks/:
 *
 *    0  new                              7  pending refund
 *    1  pending                          8  refund failed
 *    2  paid                            12  customer started payment process
 *    3  canceled
 *    4  failed
 *    5  rejected
 *    6  refunded
 *
 * Note 3 and 4: an earlier version of this file had them the other way round.
 * They map to different things downstream — a cancelled payment leaves the hold
 * alone so the customer can retry, which is also true of a failure, but the two
 * are reported differently to the office.
 *
 * 7 and 8 are refund LIFECYCLE, not payment outcomes: a refund being in flight
 * or having failed does not change the fact that the money arrived, so both stay
 * `paid` rather than pretending the booking is unpaid. Only 6, a completed
 * refund, moves it.
 *
 * 12 is "customer opened the hosted page". It is `pending`, and it is worth
 * knowing that it exists: it is a state the payment genuinely reaches, and
 * mapping it to `unknown` would have made a normal event look like a fault.
 *
 * Anything unrecognised is `unknown`, never optimistically `paid`.
 */
const STATUS_BY_ID: Record<string, PaymentStatus> = {
  "0": "pending", // new
  "1": "pending", // pending
  "2": "paid", // paid
  "3": "cancelled", // canceled
  "4": "failed", // failed
  "5": "failed", // rejected
  "6": "refunded", // refunded
  "7": "paid", // pending refund — the money still arrived
  "8": "paid", // refund failed — likewise
  "12": "pending", // customer started payment process
};

/** The same states by name, for a payload that sends words instead of ids. */
const STATUS_BY_NAME: Record<string, PaymentStatus> = {
  new: "pending",
  pending: "pending",
  paid: "paid",
  canceled: "cancelled",
  cancelled: "cancelled",
  failed: "failed",
  rejected: "failed",
  refunded: "refunded",
};

function mapStatus(raw: unknown): PaymentStatus {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return STATUS_BY_ID[value] ?? STATUS_BY_NAME[value] ?? "unknown";
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
   * SkipCash authenticates a request with an HMAC-SHA256, base64, over a
   * canonical `Key=Value,Key=Value` string built from an ORDER-SENSITIVE and
   * CASE-SENSITIVE field list.
   *
   * It is a literal string, so `Country=QA` and `country=QA` are different
   * messages and produce different hashes. That is not a detail — it is the
   * single easiest way to get an unexplained 401 out of this API.
   *
   * `pnpm payments:probe checkout` prints the exact string it signed, which is
   * the only useful thing to compare against the docs when auth fails.
   */
  private static canonical(fields: Array<[string, string]>): string {
    return fields.map(([key, value]) => `${key}=${value}`).join(",");
  }

  private sign(fields: Array<[string, string]>, secret: string): string {
    return createHmac("sha256", secret)
      .update(SkipCashProvider.canonical(fields), "utf8")
      .digest("base64");
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // Split a single name field into the first/last SkipCash wants.
    const parts = input.customer.name.trim().split(/\s+/);
    const firstName = parts[0] ?? "Customer";
    const lastName = parts.slice(1).join(" ") || firstName;

    /**
     * The signed field list, in SkipCash's documented order and casing.
     * Anything added here changes the hash, so it must match the API's own
     * canonical list exactly — this is not a place to add a field "since we
     * are sending it anyway". Unsigned extras go on the body below.
     *
     * `Uid` is a UUID in SkipCash's sample. `bookings.id` is a Postgres uuid,
     * so passing it straight through is both correct and useful: it makes the
     * gateway's own record searchable by our primary key.
     *
     * Address fields are sent EMPTY except Country. SkipCash requires them only
     * for US/UK/Canada cards, and this is a Qatari villa service — collecting a
     * postal code we have no use for, to satisfy a validation that does not
     * apply, is a field on the form for nothing. They stay in the list because
     * the canonical string includes them either way.
     */
    const fields: Array<[string, string]> = [
      ["Uid", input.bookingId],
      ["KeyId", this.config.keyId],
      ["Amount", toDecimalString(input.amount)],
      ["FirstName", firstName],
      ["LastName", lastName],
      ["Phone", input.customer.phone],
      ["Email", input.customer.email ?? ""],
      ["Street", ""],
      ["City", ""],
      ["State", ""],
      ["Country", "QA"],
      ["PostalCode", ""],
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
          /**
           * The hash IS the Authorization header. There is no separate
           * `Signature` header and the client id is not sent here — an earlier
           * version of this file did both, which is a 401 on every call.
           */
          Authorization: this.sign(fields, this.config.secretKey),
        },
        body: JSON.stringify({
          ...body,
          /**
           * Unsigned extras. SkipCash builds its comparison hash from its own
           * fixed field list, not from whatever the body happens to contain —
           * which is why the docs can say Custom2-10 go "only in the POST
           * payload". So these are safe to add and must NOT be signed.
           *
           * ReturnUrl is where the customer lands afterwards. It is NOT what
           * confirms the booking — the webhook is, and the success page polls.
           * A return URL is trivially forgeable.
           */
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
   * Verifies an inbound webhook.
   *
   * THE ORDER HERE IS NOT "VERIFY BEFORE PARSE", AND THAT IS FORCED, NOT A
   * RELAXATION. CLAUDE.md §4f states the rule as "read raw text → verify
   * signature → only then settle", which is right for a provider that hashes
   * the raw bytes (our mock does). SkipCash does not: it hashes a canonical
   * `PaymentId=..,Amount=..,StatusId=..` string assembled from named fields,
   * exactly like the outbound request. Those fields cannot be read without
   * parsing, so the sequence is necessarily parse → verify → act.
   *
   * What the original rule was actually protecting is preserved in full:
   *
   *   - Nothing is ACTED on before verification. The parse produces values in
   *     memory and nothing else; no database write, no status change, no
   *     notification.
   *   - Nothing is LOGGED before verification — or after it. The body is
   *     attacker-controlled and could carry card-shaped data planted purely to
   *     get it written into our logs. `redactSensitive` runs on the way to
   *     storage, and no branch here prints the body.
   *   - `JSON.parse` on a string is not itself a dangerous operation. The
   *     danger was ever only in trusting the result, which nothing does until
   *     the hash matches.
   *
   * A missing signature is rejected outright: treating it as acceptable would
   * let anyone who can guess a payment id confirm a booking for free.
   */
  async verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<WebhookVerification> {
    // SkipCash sends the hash in Authorization. The alternatives are tolerated
    // because a gateway moving it to a conventional header is a likelier
    // future than a gateway inventing a new scheme.
    const provided =
      input.headers.get("authorization") ??
      input.headers.get("signature") ??
      input.headers.get("x-signature");

    if (!provided) return { valid: false, reason: "missing_signature" };

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(input.rawBody) as Record<string, unknown>;
      // Tolerated in case the callback is ever wrapped the way the REST
      // responses are; the documented webhook body is flat.
      body = (parsed.resultObj ?? parsed) as Record<string, unknown>;
    } catch {
      return { valid: false, reason: "malformed_body" };
    }

    /**
     * The canonical string, per https://dev.skipcash.app/doc/web-hooks/:
     *
     *     PaymentId, Amount, StatusId, TransactionId, Custom1, VisaId
     *
     * with the documented caveat — "TransactionId and Custom1 are optional,
     * include them if you're using them" — so a field absent from the payload
     * is absent from the string, and the ORDER of the rest is unchanged. The
     * loop below is exactly that: present means included, missing means
     * skipped. Emitting an empty `TransactionId=` for a field SkipCash never
     * sent would produce a different hash and reject every genuine webhook.
     *
     * We always send TransactionId and Custom1 on checkout (both carry the
     * booking reference), so in practice all six are expected back — but the
     * rule is implemented rather than assumed, because "in practice" is doing
     * a lot of work in that sentence and the failure mode is total.
     */
    const ORDER = [
      "PaymentId",
      "Amount",
      "StatusId",
      "TransactionId",
      "Custom1",
      "VisaId",
    ] as const;

    const fields: Array<[string, string]> = [];
    for (const key of ORDER) {
      const value = body[key];
      if (value === undefined || value === null) continue;
      fields.push([key, String(value)]);
    }

    if (fields.length === 0) {
      return { valid: false, reason: "no_signable_fields" };
    }

    const expected = this.sign(fields, this.config.webhookSecret);

    // Timing-safe, and length-checked first because timingSafeEqual throws on
    // a length mismatch rather than returning false.
    const a = Buffer.from(provided.replace(/^Bearer\s+/i, "").trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: "bad_signature" };
    }

    // --- Verified. Only now is any of this trustworthy. ---------------------

    const providerRef = String(body.PaymentId ?? "");
    if (!providerRef) return { valid: false, reason: "missing_payment_id" };

    const status = mapStatus(body.StatusId);

    return {
      valid: true,
      event: {
        /**
         * SkipCash sends no event id, so the idempotency key is the payment
         * plus its resolved status. A redelivery of the same state collapses
         * onto the UNIQUE (provider, event_id) constraint; a genuine
         * transition (pending → paid) is a different key and is processed.
         *
         * Deliberately keyed on the MAPPED status, not the raw id: 7 and 8
         * both mean "still paid", and settling the same payment twice because
         * a refund attempt failed is not a transition anyone wants.
         */
        eventId: `${providerRef}:${status}`,
        providerRef,
        status,
        amount:
          body.Amount !== undefined
            ? fromDecimalString(body.Amount as string | number)
            : undefined,
        currency: typeof body.Currency === "string" ? body.Currency : undefined,
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

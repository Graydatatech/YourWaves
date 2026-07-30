import "server-only";

/**
 * How a one-time code reaches the customer.
 *
 * Kept behind an interface for three reasons: local development must not need a
 * Meta business account, the test suite must not send real messages, and the
 * client owns the WhatsApp account and may want to swap provider later without
 * the endpoints changing.
 */
export interface OtpChannel {
  send(phone: string, code: string, locale: "ar" | "en"): Promise<void>;
  /** Identifies the implementation in logs and health checks. */
  readonly name: string;
}

export class OtpDeliveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    /** True when retrying the same request could plausibly succeed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "OtpDeliveryError";
  }
}

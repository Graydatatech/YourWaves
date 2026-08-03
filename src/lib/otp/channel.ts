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
  /**
   * Where the code goes — and therefore WHAT IS PROVEN.
   *
   * A channel can only attest to the thing it can reach. Emailing a code and
   * then marking a phone number verified would prove control of an inbox while
   * claiming something about a phone, which is worth nothing. So the channel
   * declares its target and the rest of the flow follows it: the token is bound
   * to that value, and the booking routes check the same field.
   */
  readonly target: "phone" | "email";
  /** The phone or email, per `target`. */
  send(
    destination: string,
    code: string,
    locale: "ar" | "en",
  ): Promise<void>;
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

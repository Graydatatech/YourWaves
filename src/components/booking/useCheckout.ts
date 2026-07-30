"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

type CheckoutError =
  | "NOT_FOUND"
  | "NOT_HOLDING"
  | "HOLD_EXPIRED"
  | "ALREADY_PAID"
  | "PROVIDER_ERROR"
  | "NETWORK";

/**
 * Starts checkout and hands the browser to the provider.
 *
 * The redirect is `location.assign` in the SAME TAB, deliberately. Opening a
 * payment page with `window.open` loses context in iOS Safari — the customer
 * ends up on a detached tab with no back button, assumes the payment broke, and
 * often pays twice. Same-tab navigation means the provider's own return URL
 * brings them back to a page that knows what happened.
 */
export function useCheckout(bookingId: string | null, locale: "ar" | "en") {
  const t = useTranslations("booking.pay.errors");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!bookingId || paying) return;
    setPaying(true);
    setError(null);

    try {
      const response = await fetch(`/api/bookings/${bookingId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        // No amount is sent: the server prices this from the booking row.
        body: JSON.stringify({ locale }),
      });
      const body = await response.json().catch(() => ({}));

      if (response.ok && typeof body?.redirectUrl === "string") {
        window.location.assign(body.redirectUrl);
        // Deliberately stay in the `paying` state: the page is navigating away,
        // and re-enabling the button invites a second tap and a second payment.
        return;
      }

      const code: CheckoutError =
        typeof body?.code === "string"
          ? (body.code as CheckoutError)
          : "PROVIDER_ERROR";
      setError(t(code));
      setPaying(false);
    } catch {
      setError(t("NETWORK"));
      setPaying(false);
    }
  }, [bookingId, locale, paying, t]);

  return { start, paying, error };
}

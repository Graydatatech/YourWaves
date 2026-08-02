"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bidi } from "@/components/ui";
import {
  formatFullDate,
  formatMoney,
  formatTime,
  type Locale,
} from "@/lib/booking/format";

/**
 * The return page after payment.
 *
 * IT DOES NOT CONFIRM ANYTHING. Arriving here means the provider redirected the
 * browser, which anyone could do by typing the URL. The page polls the server
 * until the webhook has settled the booking, and shows a "confirming" state
 * meanwhile.
 *
 * After FALLBACK_AFTER_MS of polling it adds `?fallback=1`, which asks the
 * provider directly — still server-side, still settled through the same SQL the
 * webhook uses. The browser never becomes evidence of payment.
 */

const POLL_INTERVAL_MS = 1500;
const FALLBACK_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 90_000;

export type BookingResultData = {
  reference: string;
  status: string;
  paymentStatus: string | null;
  confirmed: boolean;
  bookingDate?: string;
  preferredStart?: string;
  priceTotal?: number;
  currency?: string;
  customerName?: string;
  addressLine?: string;
  area?: string | null;
};

type Phase = "confirming" | "confirmed" | "failed" | "timeout" | "notFound";

type State = {
  phase: Phase;
  data: BookingResultData | null;
  elapsed: number;
};

type Action =
  | { type: "poll"; elapsed: number }
  | { type: "data"; data: BookingResultData }
  | { type: "notFound" }
  | { type: "timeout" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "poll":
      return { ...state, elapsed: action.elapsed };
    case "data": {
      const failed =
        action.data.paymentStatus === "failed" && !action.data.confirmed;
      return {
        ...state,
        data: action.data,
        phase: action.data.confirmed
          ? "confirmed"
          : failed
            ? "failed"
            : state.phase,
      };
    }
    case "notFound":
      return { ...state, phase: "notFound" };
    case "timeout":
      return state.phase === "confirming"
        ? { ...state, phase: "timeout" }
        : state;
    default:
      return state;
  }
}

export function BookingResult({
  reference,
  locale,
  intent,
  whatsappNumber,
}: {
  reference: string;
  locale: Locale;
  /** `success` polls; `failed` shows the retry route immediately. */
  intent: "success" | "failed";
  whatsappNumber: string;
}) {
  const t = useTranslations("booking.result");
  const [state, dispatch] = useReducer(reducer, {
    phase: intent === "failed" ? "failed" : "confirming",
    data: null,
    elapsed: 0,
  });

  const poll = useCallback(
    async (withFallback: boolean) => {
      try {
        const response = await fetch(
          `/api/bookings/by-reference/${reference}/status${withFallback ? "?fallback=1" : ""}`,
          { cache: "no-store" },
        );
        if (response.status === 404) {
          dispatch({ type: "notFound" });
          return;
        }
        if (!response.ok) return;
        dispatch({
          type: "data",
          data: (await response.json()) as BookingResultData,
        });
      } catch {
        // Transient; the next tick tries again.
      }
    },
    [reference],
  );

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    let usedFallback = false;

    // Poll once immediately: usually the webhook has already landed.
    void poll(false);

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const elapsed = Date.now() - started;
      dispatch({ type: "poll", elapsed });

      if (elapsed > GIVE_UP_AFTER_MS) {
        dispatch({ type: "timeout" });
        window.clearInterval(timer);
        return;
      }

      // The fallback is a paid provider call, so it fires once, late, and only
      // if the webhook has not already won.
      const shouldFallback = elapsed >= FALLBACK_AFTER_MS && !usedFallback;
      if (shouldFallback) usedFallback = true;
      void poll(shouldFallback);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [poll]);

  // Stop polling once settled.
  const settled = state.phase === "confirmed" || state.phase === "notFound";
  useEffect(() => {
    if (!settled) return;
    // The interval above clears itself on unmount; nothing further to do.
  }, [settled]);

  const data = state.data;

  // --- Confirming ---------------------------------------------------------
  if (state.phase === "confirming") {
    return (
      <div className="text-center" role="status" aria-live="polite">
        <div
          aria-hidden="true"
          className="border-accent/30 border-t-accent mx-auto size-12 animate-spin rounded-full border-4"
        />
        <h1 className="text-h2 text-ink mt-6">{t("confirmingTitle")}</h1>
        <p className="text-body text-muted mx-auto mt-3 max-w-md">
          {t("confirmingBody")}
        </p>
        <p className="text-muted-2 mt-4 text-sm">
          {t("reference")} <Bidi>{reference}</Bidi>
        </p>
        {state.elapsed > FALLBACK_AFTER_MS && (
          <p className="text-muted-2 mt-2 text-sm">{t("stillChecking")}</p>
        )}
      </div>
    );
  }

  if (state.phase === "notFound") {
    return (
      <div className="text-center" role="alert">
        <h1 className="text-h2 text-ink">{t("notFoundTitle")}</h1>
        <p className="text-body text-muted mx-auto mt-3 max-w-md">
          {t("notFoundBody")}
        </p>
        <ContactRow whatsappNumber={whatsappNumber} reference={reference} />
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div className="text-center" role="alert">
        <div
          aria-hidden="true"
          className="bg-danger-surface text-danger mx-auto grid size-14 place-items-center rounded-full"
        >
          <svg viewBox="0 0 24 24" className="size-7">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1 className="text-h2 text-ink mt-6">{t("failedTitle")}</h1>
        <p className="text-body text-muted mx-auto mt-3 max-w-md">
          {t("failedBody")}
        </p>
        <p className="text-muted-2 mt-4 text-sm">
          {t("reference")} <Bidi>{reference}</Bidi>
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <a
            href={`/${locale}#booking`}
            className={cn(
              "bg-brand text-ink-deep shadow-cta inline-flex min-h-13 items-center",
              "rounded-pill justify-center px-7 text-base font-bold",
            )}
          >
            {t("tryAgain")}
          </a>
        </div>
        <ContactRow whatsappNumber={whatsappNumber} reference={reference} />
      </div>
    );
  }

  if (state.phase === "timeout") {
    return (
      <div className="text-center" role="alert">
        <h1 className="text-h2 text-ink">{t("timeoutTitle")}</h1>
        <p className="text-body text-muted mx-auto mt-3 max-w-md">
          {t("timeoutBody")}
        </p>
        <p className="text-muted-2 mt-4 text-sm">
          {t("reference")} <Bidi>{reference}</Bidi>
        </p>
        <ContactRow whatsappNumber={whatsappNumber} reference={reference} />
      </div>
    );
  }

  // --- Confirmed ----------------------------------------------------------
  return (
    <div>
      <div className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-full bg-green-100 text-green-700"
        >
          <svg viewBox="0 0 24 24" className="size-8">
            <path
              d="M5 13l4.5 4.5L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-h2 text-ink mt-5">{t("confirmedTitle")}</h1>
        <p className="text-body text-muted mx-auto mt-3 max-w-md">
          {t("confirmedBody")}
        </p>
      </div>

      {/* The reference is what customers screenshot and quote, so it is the
          largest thing on the page after the heading. */}
      <div className="bg-summary border-border rounded-card mt-7 border p-5 text-center">
        <p className="text-muted-2 text-xs font-bold tracking-[0.16em] uppercase">
          {t("reference")}
        </p>
        <p className="font-display text-accent-strong mt-1.5 text-[clamp(26px,7vw,38px)] leading-none font-extrabold">
          <Bidi>{reference}</Bidi>
        </p>
      </div>

      {data && (
        <dl className="mt-6 space-y-0">
          <Row label={t("date")}>
            {data.bookingDate && (
              <Bidi>{formatFullDate(data.bookingDate, locale)}</Bidi>
            )}
          </Row>
          <Row label={t("time")}>
            {data.preferredStart && (
              <Bidi>{formatTime(data.preferredStart, locale)}</Bidi>
            )}
          </Row>
          <Row label={t("address")}>
            {[data.addressLine, data.area].filter(Boolean).join(", ")}
          </Row>
          <Row label={t("paid")}>
            {data.priceTotal !== undefined && data.currency && (
              <Bidi>{formatMoney(data.priceTotal, data.currency, locale)}</Bidi>
            )}
          </Row>
        </dl>
      )}

      {/* Actions. Stacked and full-width: this is read on a phone, often inside
          the WhatsApp in-app browser. */}
      <div className="mt-7 flex flex-col gap-3">
        <a
          href={`/api/bookings/by-reference/${reference}/calendar`}
          download
          className={cn(
            "border-border bg-surface text-ink hover:border-accent/50",
            "rounded-pill flex min-h-13 items-center justify-center gap-2 border",
            "px-6 text-base font-bold transition-colors",
          )}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
            <rect
              x="2.5"
              y="4"
              width="15"
              height="13.5"
              rx="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M2.5 8h15M7 2.5v3M13 2.5v3"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          {t("addToCalendar")}
        </a>

        <a
          // wa.me opens the WhatsApp app directly on a phone.
          href={`https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(
            t("whatsappMessage", { reference }),
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "rounded-pill flex min-h-13 items-center justify-center gap-2",
            "bg-[#25D366] px-6 text-base font-bold text-white",
          )}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-current"
          >
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5 0-1.1 0-1.9-.3a10 10 0 0 1-4-2.8c-1-1.2-1.7-2.6-1.7-3.6 0-1 .5-1.6.8-1.9.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4l.8 1.8c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6.2.4.7 1.1 1.3 1.6.8.7 1.4.9 1.6 1 .2.1.4 0 .5-.1l.6-.7c.2-.2.3-.1.5-.1l1.7.8c.2.1.4.2.4.4 0 .2 0 .8-.3 1.1Z" />
          </svg>
          {t("messageUs")}
        </a>
      </div>

      {/* Preparation notes — what they actually need to know before the day. */}
      <section className="border-border rounded-card mt-7 border p-5">
        <h2 className="text-ink text-base font-bold">{t("prepTitle")}</h2>
        <ul className="mt-3 space-y-2.5">
          {(["space", "power", "water", "arrival"] as const).map((key) => (
            <li key={key} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="bg-accent mt-2 size-1.5 shrink-0 rounded-full"
              />
              <span className="text-muted text-sm leading-relaxed">
                {t(`prep.${key}`)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex items-baseline justify-between gap-4 border-b py-3 last:border-0">
      <dt className="text-muted shrink-0 text-sm">{label}</dt>
      <dd className="text-ink text-end text-sm font-bold">{children}</dd>
    </div>
  );
}

function ContactRow({
  whatsappNumber,
  reference,
}: {
  whatsappNumber: string;
  reference: string;
}) {
  const t = useTranslations("booking.result");
  return (
    <a
      href={`https://wa.me/${whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(
        t("whatsappMessage", { reference }),
      )}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-strong mt-6 inline-flex min-h-11 items-center text-sm font-bold underline"
    >
      {t("messageUs")}
    </a>
  );
}

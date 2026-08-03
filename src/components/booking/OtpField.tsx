"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Bidi } from "@/components/ui";

const CODE_LENGTH = 4;
const RESEND_COOLDOWN_SECONDS = 60;

export type OtpFieldProps = {
  /**
   * The contact being verified — an E.164 number or an email address depending
   * on `target` — or null while what the customer has typed is not valid yet.
   */
  destination: string | null;
  /** Which contact the active channel proves. Drives the copy, not the wiring. */
  target: "phone" | "email";
  locale: "ar" | "en";
  /** The already-verified contact, if any. */
  verifiedContact?: string;
  onVerified: (destination: string) => void;
};

type Phase = "idle" | "sending" | "sent" | "verifying" | "verified" | "error";

type ErrorKey =
  | "wrongCode"
  | "expired"
  | "tooManyAttempts"
  | "rateLimited"
  | "deliveryFailed"
  | "network"
  | "invalidPhone";

/**
 * One-time-code verification (SRS 3.5), over WhatsApp or email.
 *
 * The mechanism is identical either way — the server decides which channel is
 * live and this component only posts a `destination` — so `target` changes
 * WORDS and nothing else. Naming the wrong channel in the copy is the failure
 * that matters here: "check WhatsApp" next to an email box sends the customer
 * to an app that will never receive anything, and they abandon the form rather
 * than report it.
 *
 * Editing the contact must discard any code in progress. That is handled by the
 * PARENT keying this component on the value, so a change remounts it with fresh
 * state — rather than an effect that resets six pieces of state and has to be
 * kept in step with them.
 *
 * Four separate boxes, but only the FIRST carries
 * `autocomplete="one-time-code"`. iOS offers the code from the notification for
 * a single field and fills the whole string into it, so the first box receives
 * "1234" in one change event — which is the same path as a paste, and is
 * distributed across the boxes by `distribute()`. Putting the token on all four
 * makes the platform's choice of target ambiguous.
 */
export function OtpField({
  destination,
  target,
  locale,
  verifiedContact,
  onVerified,
}: OtpFieldProps) {
  const t = useTranslations("booking.otp");
  const groupId = useId();

  /**
   * Message keys per channel, as literals rather than a template string.
   *
   * next-intl types keys against the real catalogue, so `t(`intro${Suffix}`)`
   * would not type-check — and that is the rule working: a channel cannot be
   * added without its copy existing in both locales.
   */
  const copy =
    target === "email"
      ? ({
          intro: "introEmail",
          needContact: "needValidEmail",
          enterCode: "enterCodeEmail",
          verified: "verifiedEmail",
          invalid: "invalidEmail",
        } as const)
      : ({
          intro: "intro",
          needContact: "needValidPhone",
          enterCode: "enterCode",
          verified: "verified",
          invalid: "invalidPhone",
        } as const);

  const isVerified = destination !== null && destination === verifiedContact;

  const [phase, setPhase] = useState<Phase>(isVerified ? "verified" : "idle");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [digits, setDigits] = useState<string[]>(() =>
    Array(CODE_LENGTH).fill(""),
  );
  const [cooldown, setCooldown] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Countdown for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const focusBox = (index: number) => {
    inputsRef.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();
  };

  const submit = useCallback(
    async (code: string) => {
      if (!destination) return;
      setPhase("verifying");
      setError(null);
      try {
        const response = await fetch("/api/otp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination, code }),
        });
        const body = await response.json().catch(() => ({}));

        if (response.ok) {
          setPhase("verified");
          onVerified(destination);
          return;
        }

        setDigits(Array(CODE_LENGTH).fill(""));
        setPhase("error");
        if (body?.error === "too_many_attempts") setError("tooManyAttempts");
        else if (body?.error === "expired" || body?.error === "no_code")
          setError("expired");
        else if (
          body?.error === "invalid_phone" ||
          body?.error === "invalid_email"
        )
          setError("invalidPhone");
        else setError("wrongCode");

        setAttemptsLeft(
          typeof body?.attempts_remaining === "number"
            ? body.attempts_remaining
            : null,
        );
        focusBox(0);
      } catch {
        setPhase("error");
        setError("network");
      }
    },
    [destination, onVerified],
  );

  /** Spreads a multi-character value across the boxes from `start`. */
  const distribute = (start: number, value: string) => {
    const incoming = value.replace(/\D/g, "").slice(0, CODE_LENGTH - start);
    if (!incoming) return;

    const next = [...digits];
    for (let i = 0; i < incoming.length; i++) next[start + i] = incoming[i];
    setDigits(next);

    const filled = start + incoming.length;
    focusBox(filled);

    // Auto-submit the moment the last box is filled.
    const joined = next.join("");
    if (joined.length === CODE_LENGTH && !joined.includes("")) {
      void submit(joined);
    }
  };

  async function requestCode() {
    if (!destination || cooldown > 0) return;
    setPhase("sending");
    setError(null);
    setDevCode(null);
    try {
      const response = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, locale }),
      });
      const body = await response.json().catch(() => ({}));

      if (response.ok) {
        setPhase("sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setDigits(Array(CODE_LENGTH).fill(""));
        // Only ever present with OTP_DEV_ECHO in a non-production build.
        if (typeof body?.dev_code === "string") setDevCode(body.dev_code);
        // Give the browser a frame to paint the boxes before focusing, so the
        // keyboard opens against the final layout.
        requestAnimationFrame(() => focusBox(0));
        return;
      }

      setPhase("error");
      if (response.status === 429) {
        setError("rateLimited");
        setCooldown(Number(body?.retry_after) || RESEND_COOLDOWN_SECONDS);
      } else if (response.status === 502) {
        setError("deliveryFailed");
      } else if (
        body?.error === "invalid_phone" ||
        body?.error === "invalid_email"
      ) {
        setError("invalidPhone");
      } else {
        setError("deliveryFailed");
      }
    } catch {
      setPhase("error");
      setError("network");
    }
  }

  // --- Verified ----------------------------------------------------------
  if (phase === "verified") {
    return (
      <div
        className="flex items-center gap-2.5 rounded-2xl border border-green-600/30 bg-green-50 px-4 py-3"
        role="status"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5 shrink-0 text-green-700"
        >
          <path
            d="M4 10.5l4 4 8-9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-bold text-green-900">
          {t(copy.verified)}
        </span>
      </div>
    );
  }

  const showBoxes =
    phase === "sent" || phase === "verifying" || phase === "error";

  return (
    <div ref={containerRef} className="space-y-3">
      {!showBoxes && (
        <>
          <p className="text-muted text-sm">{t(copy.intro)}</p>
          <button
            type="button"
            onClick={requestCode}
            disabled={!destination || phase === "sending" || cooldown > 0}
            className={cn(
              "bg-brand text-ink-deep shadow-cta inline-flex min-h-12 items-center",
              "rounded-pill justify-center px-6 text-[15px] font-bold",
              "transition-[filter] hover:brightness-105",
              "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
            )}
          >
            {phase === "sending" ? t("sending") : t("sendCode")}
          </button>
          {/* Never a silently dead button: say why it cannot be pressed. */}
          {!destination && (
            <p className="text-muted-2 text-sm">{t(copy.needContact)}</p>
          )}
        </>
      )}

      {showBoxes && (
        <>
          <p className="text-muted text-sm">{t(copy.enterCode)}</p>
          {/* Email lands in spam far more often than a WhatsApp message goes
              missing, and "send a new code" costs a 60s cooldown — so say this
              BEFORE they press it, not after. */}
          {target === "email" && (
            <p className="text-muted-2 text-sm">{t("checkSpam")}</p>
          )}

          {/* The boxes. 56x56 on mobile so they clear a thumb. */}
          <div
            role="group"
            aria-labelledby={`${groupId}-label`}
            // Always LTR: a code is a number run and its digit order must not
            // mirror in Arabic.
            dir="ltr"
            className="flex gap-2.5"
          >
            <span id={`${groupId}-label`} className="sr-only">
              {t("codeGroupLabel")}
            </span>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => {
                  inputsRef.current[index] = node;
                }}
                type="text"
                inputMode="numeric"
                // Only the first box: see the component note.
                autoComplete={index === 0 ? "one-time-code" : "off"}
                // maxLength 1 keeps a box to one digit, but iOS autofill and
                // paste both arrive as a longer string, which distribute()
                // spreads across the boxes.
                maxLength={CODE_LENGTH}
                value={digit}
                aria-label={t("digitLabel", { position: index + 1 })}
                aria-invalid={phase === "error" || undefined}
                disabled={phase === "verifying"}
                onFocus={(event) => {
                  // Keep the field above the on-screen keyboard.
                  event.currentTarget.scrollIntoView({
                    block: "center",
                    behavior: "smooth",
                  });
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.length > 1) {
                    distribute(index, value);
                    return;
                  }
                  const cleaned = value.replace(/\D/g, "");
                  const next = [...digits];
                  next[index] = cleaned;
                  setDigits(next);
                  if (cleaned) {
                    const joined = next.join("");
                    if (
                      joined.length === CODE_LENGTH &&
                      !next.some((d) => d === "")
                    ) {
                      void submit(joined);
                    } else {
                      focusBox(index + 1);
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Backspace" &&
                    !digits[index] &&
                    index > 0
                  ) {
                    event.preventDefault();
                    const next = [...digits];
                    next[index - 1] = "";
                    setDigits(next);
                    focusBox(index - 1);
                  }
                  if (event.key === "ArrowLeft") focusBox(index - 1);
                  if (event.key === "ArrowRight") focusBox(index + 1);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  distribute(index, event.clipboardData.getData("text"));
                }}
                className={cn(
                  "size-14 shrink-0 rounded-2xl border text-center",
                  // 20px: comfortably above the 16px iOS zoom threshold.
                  "text-[20px] font-bold tabular-nums",
                  "focus-visible:border-accent focus-visible:outline-focus",
                  "focus-visible:outline-2 focus-visible:outline-offset-0",
                  phase === "error"
                    ? "border-danger bg-danger-surface text-ink"
                    : "border-border bg-surface text-ink",
                  phase === "verifying" && "opacity-60",
                )}
              />
            ))}
          </div>

          {/* Status line, announced. */}
          <p
            role="alert"
            aria-live="polite"
            className="text-sm font-semibold empty:hidden"
          >
            {phase === "verifying" && (
              <span className="text-muted">{t("verifying")}</span>
            )}
            {phase === "error" && error && (
              <span className="text-danger">
                {t(error === "invalidPhone" ? copy.invalid : error)}
                {attemptsLeft !== null && attemptsLeft > 0 && (
                  <>
                    {" "}
                    <Bidi>{t("attemptsLeft", { count: attemptsLeft })}</Bidi>
                  </>
                )}
              </span>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={requestCode}
              disabled={cooldown > 0 || phase === "verifying"}
              className={cn(
                "border-border bg-surface text-ink hover:border-accent/50",
                "rounded-pill inline-flex min-h-11 items-center border px-4",
                "text-sm font-semibold transition-colors",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
            >
              {cooldown > 0 ? (
                <Bidi>{t("resendIn", { seconds: cooldown })}</Bidi>
              ) : (
                t("resend")
              )}
            </button>
          </div>

          {devCode && (
            // Development aid only: the API returns dev_code exclusively when
            // OTP_DEV_ECHO=true outside production.
            <p className="rounded-xl border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Bidi>{`DEV: ${devCode}`}</Bidi>
            </p>
          )}
        </>
      )}
    </div>
  );
}

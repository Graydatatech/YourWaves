"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";
import { useBooking } from "./BookingProvider";

type Loaded = { paragraphs: string[]; isFallback: boolean };

export type TermsStepProps = {
  locale: "ar" | "en";
  showErrors: boolean;
};

/**
 * The last step: read the terms, then agree to them.
 *
 * Its own step rather than a tick under the phone number. This is the only
 * field on the form that is a legal act rather than an answer, and it is the
 * last thing before money moves — buried at the bottom of "Details" it was
 * something to scroll past.
 *
 * The text is fetched HERE, not carried in /api/settings. Settings is fetched
 * by every visitor the instant the form mounts and terms can run to pages;
 * only somebody who reached this step needs the words. §4h records the same
 * reasoning for why `termsAvailable` is a boolean there.
 *
 * Rendered as text nodes from an array of paragraphs, never as HTML. An admin
 * types into a textarea, and accepting markup would let anyone with back-office
 * access put a script on a page that takes payments.
 */
export function TermsStep({ locale, showErrors }: TermsStepProps) {
  const t = useTranslations("booking.terms");
  const { draft, patch } = useBooking();

  const boxId = useId();
  const checkboxId = useId();
  const errorId = `${checkboxId}-error`;

  const [terms, setTerms] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTerms(null);
    setFailed(false);
    fetch(`/api/terms?locale=${locale}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((data: Loaded) => {
        if (cancelled) return;
        setTerms({
          paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs : [],
          isFallback: data.isFallback === true,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Refetches on a language switch: the terms are per-locale, and the draft
    // survives the navigation while this component remounts.
  }, [locale]);

  const accepted = draft.termsAccepted === true;
  const unread = terms === null && !failed;
  const empty = failed || (terms !== null && terms.paragraphs.length === 0);

  return (
    <div className="space-y-5">
      {/* The text ---------------------------------------------------------
          A bounded, scrollable region rather than the full text inline. On a
          phone, terms of any length would push the checkbox so far down that
          the step looks like it has no action on it — and the customer cannot
          see what they are about to agree to and the agreement at the same
          time. `tabIndex={0}` because a scrollable region has to be reachable
          by keyboard, and `role="region"` + a label so a screen reader
          announces what it is rather than reading an unnamed scroll box. */}
      <div
        id={boxId}
        role="region"
        aria-label={t("boxLabel")}
        tabIndex={0}
        className={cn(
          "border-border bg-surface rounded-card max-h-72 overflow-y-auto border",
          "px-4 py-4 text-[15px] leading-relaxed",
          "focus-visible:outline-focus focus-visible:outline-2",
          "focus-visible:outline-offset-2",
        )}
      >
        {unread ? (
          <p className="text-muted-2">{t("loading")}</p>
        ) : empty ? (
          <p className="text-muted-2">{t("unavailable")}</p>
        ) : (
          <>
            {terms?.isFallback && (
              <p className="text-muted-2 mb-3 text-sm italic">
                {t("englishFallback")}
              </p>
            )}
            {terms?.paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className={cn("text-ink", index > 0 && "mt-3")}
                // dir="auto" so a paragraph resolves from its own first strong
                // character. Terms are often part English (a company name, a
                // policy reference) inside Arabic, and the surrounding page
                // direction would otherwise reorder the run — §4.
                dir="auto"
              >
                {paragraph}
              </p>
            ))}
          </>
        )}
      </div>

      {/* A way to read them properly. The scroll box is for agreeing in
          context; /terms is for reading at length, keeping, or sending to
          somebody else. Opens in a new tab so a half-filled booking is not
          navigated away from. */}
      <p className="text-muted-2 text-sm">
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-strong font-semibold underline"
        >
          {t("openFull")}
        </Link>
      </p>

      {/* The agreement --------------------------------------------------- */}
      <div
        className={cn(
          "rounded-card border p-4",
          showErrors && !accepted
            ? "border-danger bg-danger-surface"
            : "border-border bg-surface",
        )}
      >
        <div className="flex items-start gap-3">
          <input
            id={checkboxId}
            type="checkbox"
            checked={accepted}
            onChange={(event) => patch({ termsAccepted: event.target.checked })}
            aria-describedby={showErrors && !accepted ? errorId : undefined}
            aria-invalid={(showErrors && !accepted) || undefined}
            // 20px and a 44px hit area from the label wrapping it: a default
            // checkbox is ~13px, which is under the tap target minimum and is
            // the single control this whole step exists for.
            className={cn(
              "accent-accent mt-0.5 size-5 shrink-0 cursor-pointer",
              "focus-visible:outline-focus focus-visible:outline-2",
              "focus-visible:outline-offset-2",
            )}
          />
          <label
            htmlFor={checkboxId}
            className="text-ink cursor-pointer text-[15px] leading-relaxed font-semibold"
          >
            {t("agree")}
          </label>
        </div>

        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-danger mt-2 text-sm font-semibold empty:hidden"
        >
          {showErrors && !accepted ? t("required") : ""}
        </p>
      </div>

      <p className="text-muted-2 text-sm">{t("nextIsPayment")}</p>
    </div>
  );
}

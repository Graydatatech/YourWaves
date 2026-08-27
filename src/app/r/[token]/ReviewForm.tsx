"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ReviewInvite } from "@/lib/reviews/service";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * One question and a comment box.
 *
 * Deliberately the whole page rather than a section of one: the customer
 * arrived from a link that asked them one thing, and anything else on screen is
 * a reason to close the tab.
 *
 * A submitted review can be edited until the link expires. Somebody who taps a
 * rating and then thinks of what they wanted to say should be able to add it —
 * and publication is a separate, moderated act, so there is no cost to us.
 */
export function ReviewForm({
  token,
  invite,
}: {
  token: string;
  invite: ReviewInvite;
}) {
  const t = useTranslations("review");

  const [rating, setRating] = useState(invite.rating ?? 0);
  const [comment, setComment] = useState(invite.comment ?? "");
  const [name, setName] = useState(invite.authorName);
  const [consent, setConsent] = useState(invite.consentToPublish);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(invite.submitted);
  const [error, setError] = useState<string | null>(null);

  const nameMissing = name.trim() === "";

  async function submit() {
    if (rating === 0 || nameMissing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment,
          authorName: name,
          consentToPublish: consent,
        }),
      });
      if (!response.ok) {
        setError(t("failed"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="text-center" role="status">
        <h1 className="text-ink text-2xl font-extrabold">{t("thanksTitle")}</h1>
        <p className="text-muted pt-3 text-lg">{t("thanksBody")}</p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="text-muted hover:text-ink mt-6 min-h-11 text-sm font-semibold underline"
        >
          {t("edit")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-ink text-2xl font-extrabold">{t("title")}</h1>
      <p className="text-muted pt-2 text-base">
        {t("intro", { name: invite.customerName })}
      </p>

      {/* Rating ------------------------------------------------------------
          A radiogroup, not five buttons: it is one choice with five options,
          and a screen reader should hear it that way. Arrow keys move within a
          radiogroup for free. */}
      <fieldset className="mt-7">
        <legend className="text-ink text-sm font-bold">
          {t("ratingLabel")}
        </legend>
        <div role="radiogroup" aria-label={t("ratingLabel")} className="mt-2 flex gap-1">
          {STARS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={t("ratingOption", { value })}
              onClick={() => setRating(value)}
              className={cn(
                "tap-target grid place-items-center rounded-xl text-3xl",
                "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
                value <= rating ? "text-accent" : "text-ink/20",
              )}
            >
              {/* aria-hidden: the star is decoration, the button carries the
                  label. Otherwise a screen reader reads "star star star". */}
              <span aria-hidden="true">★</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Comment ---------------------------------------------------------- */}
      <div className="mt-6">
        <label htmlFor="review-comment" className="text-ink text-sm font-bold">
          {t("commentLabel")}
        </label>
        <p className="text-muted-2 mt-1 mb-2 text-sm">{t("commentHint")}</p>
        <textarea
          id="review-comment"
          rows={5}
          maxLength={2000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("commentPlaceholder")}
          className={cn(
            "rounded-input border-border bg-surface w-full border px-4 py-3",
            // 16px minimum, or iOS Safari zooms the viewport on focus.
            "text-ink placeholder:text-muted-3 text-[16px]",
            "focus-visible:border-accent focus-visible:outline-focus",
            "focus-visible:outline-2 focus-visible:outline-offset-0",
          )}
        />
      </div>

      {/* Name -------------------------------------------------------------
          Pre-filled from the booking and editable: somebody may be glad to be
          quoted without their full name on a marketing page. REQUIRED, though
          — a published quote with nothing under it is the thing a reader
          discounts fastest, and the pre-fill means the requirement almost
          never bites. It is reachable only by clearing the box deliberately,
          which is a choice worth stopping. */}
      <div className="mt-4">
        <label htmlFor="review-name" className="text-ink text-sm font-bold">
          {t("nameLabel")}{" "}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        </label>
        <p className="text-muted-2 mt-1 mb-2 text-sm">{t("nameHint")}</p>
        <input
          id="review-name"
          value={name}
          maxLength={120}
          required
          aria-required="true"
          aria-invalid={nameMissing || undefined}
          onChange={(event) => setName(event.target.value)}
          className={cn(
            "rounded-input border-border bg-surface min-h-11 w-full border px-4",
            "text-ink text-[16px]",
            "focus-visible:border-accent focus-visible:outline-focus",
            "focus-visible:outline-2 focus-visible:outline-offset-0",
          )}
        />
      </div>

      {/* Consent ------------------------------------------------------------
          Unticked by default and never required: the survey's job is to learn
          how the day went, and making publication the price of answering would
          buy a worse answer. Somebody who says nothing here has said no.

          Only asked once there is something to publish — offering to show a
          comment that has not been written is a question about nothing. */}
      {comment.trim() !== "" && (
        <div
          className={cn(
            "rounded-card border-border bg-surface mt-6 border p-4",
          )}
        >
          <div className="flex items-start gap-3">
            <input
              id="review-consent"
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              // 20px: a default checkbox is ~13px, under the tap minimum, and
              // this is the one control on the page with a consequence beyond
              // our own inbox.
              className={cn(
                "accent-accent mt-0.5 size-5 shrink-0 cursor-pointer",
                "focus-visible:outline-focus focus-visible:outline-2",
                "focus-visible:outline-offset-2",
              )}
            />
            <label
              htmlFor="review-consent"
              className="text-ink cursor-pointer text-[15px] leading-relaxed font-semibold"
            >
              {t("consentLabel")}
            </label>
          </div>
          <p className="text-muted-2 mt-2 text-sm">{t("consentHint")}</p>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={rating === 0 || nameMissing || busy}
        className={cn(
          "bg-brand text-ink-deep shadow-cta mt-7 flex min-h-13 w-full items-center",
          "rounded-pill justify-center px-6 text-base font-bold",
          "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        )}
      >
        {busy ? t("sending") : t("submit")}
      </button>

      {/* One reason at a time, and the rating first, because that is the one
          the page is built around — telling somebody about two missing fields
          when they have filled in neither is noise. */}
      {rating === 0 ? (
        <p className="text-muted-2 pt-2 text-center text-sm">
          {t("ratingRequired")}
        </p>
      ) : nameMissing ? (
        <p className="text-muted-2 pt-2 text-center text-sm">
          {t("nameRequired")}
        </p>
      ) : null}

      {error && (
        <p role="alert" className="text-danger pt-3 text-center text-sm font-semibold">
          {error}
        </p>
      )}

      <p className="text-muted-2 pt-6 text-center text-xs">
        {t("privacy")}
      </p>
    </div>
  );
}

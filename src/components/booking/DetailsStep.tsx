"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { cn } from "@/lib/cn";
import { Input, Label } from "@/components/ui";
import {
  DIAL_CODES,
  DEFAULT_DIAL_CODE,
  isPhoneVerified,
  toE164,
} from "@/lib/booking/schema";
import { BOOKING_FORM } from "@/lib/booking/formConfig";
import { useBooking } from "./BookingProvider";
import { OtpField } from "./OtpField";

export type DetailsStepProps = {
  showErrors: boolean;
};

/**
 * Name, mobile and optional email.
 *
 * Every field carries a real <label> (not a placeholder standing in for one)
 * plus the right `autocomplete` token, so mobile autofill offers the correct
 * saved value. `inputMode="tel"` gives the phone field a numeric keypad without
 * `type="tel"`'s looser validation semantics.
 *
 * Once the number is verified the field is LOCKED (readOnly + a change button)
 * rather than left editable. Verification is keyed to the exact number, so a
 * silent edit would revoke it without the customer noticing they had gone back
 * to unverified.
 */
export function DetailsStep({ showErrors }: DetailsStepProps) {
  const t = useTranslations("booking.details");
  const { draft, patch, locale } = useBooking();

  const nameId = useId();
  const dialId = useId();
  const phoneId = useId();
  const emailId = useId();
  const phoneHintId = `${phoneId}-hint`;

  const name = draft.customerName ?? "";
  const dial = draft.dialCode ?? DEFAULT_DIAL_CODE;
  const national = draft.phoneNational ?? "";
  const email = draft.customerEmail ?? "";

  const nameTooShort = name.trim().length < 2;
  // Only complain about a partly-typed number once there is something to judge.
  const phoneInvalid = national.trim() !== "" && !toE164(dial, national);
  const phoneMissing = national.trim() === "";
  const emailInvalid =
    email.trim() !== "" && !z.string().email().safeParse(email.trim()).success;

  const e164 = toE164(dial, national);
  const verified = isPhoneVerified(draft);

  return (
    <div className="space-y-6">
      {/* Name ------------------------------------------------------------- */}
      <div>
        <Label htmlFor={nameId} required>
          {t("nameLabel")}
        </Label>
        <Input
          id={nameId}
          className="mt-2"
          value={name}
          onChange={(event) => patch({ customerName: event.target.value })}
          placeholder={t("namePlaceholder")}
          autoComplete="name"
          invalid={showErrors && nameTooShort}
          aria-describedby={
            showErrors && nameTooShort ? `${nameId}-error` : undefined
          }
        />
        <p
          id={`${nameId}-error`}
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-danger empty:hidden"
        >
          {showErrors && nameTooShort ? t("nameError") : ""}
        </p>
      </div>

      {/* Mobile ----------------------------------------------------------- */}
      <div>
        <Label htmlFor={phoneId} required>
          {t("phoneLabel")}
        </Label>
        <div className="mt-2 flex gap-2">
          {/* Native select: the platform picker is faster on a phone and is
              already localised and RTL-aware. */}
          <label htmlFor={dialId} className="sr-only">
            {t("dialCodeLabel")}
          </label>
          <select
            id={dialId}
            value={dial}
            onChange={(event) => patch({ dialCode: event.target.value })}
            disabled={verified}
            dir="ltr"
            className={cn(
              "rounded-input border-border bg-surface text-ink border",
              "min-h-11 shrink-0 px-3 text-[16px] font-semibold",
              "focus-visible:border-accent focus-visible:outline-focus",
              "focus-visible:outline-2 focus-visible:outline-offset-0",
            )}
          >
            {DIAL_CODES.map((country) => (
              <option key={country.code} value={country.dial}>
                {country.flag} {country.dial}
              </option>
            ))}
          </select>

          <Input
            id={phoneId}
            // inputMode drives the on-screen keypad; type stays text so the
            // browser does not silently strip characters we want to validate.
            inputMode="tel"
            type="text"
            dir="ltr"
            value={national}
            onChange={(event) => patch({ phoneNational: event.target.value })}
            readOnly={verified}
            placeholder={t("phonePlaceholder")}
            autoComplete="tel-national"
            invalid={(showErrors && phoneMissing) || phoneInvalid}
            aria-describedby={phoneHintId}
          />
        </div>
        <p id={phoneHintId} className="text-muted-2 mt-1 text-sm">
          {/* The standard hint promises a verification step. With that step
              hidden the promise would be a lie, so the copy follows the flag. */}
          {BOOKING_FORM.phoneVerification
            ? t("phoneHint")
            : t("phoneHintNoVerify")}
        </p>
        <p
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-danger empty:hidden"
        >
          {phoneInvalid
            ? t("phoneError")
            : showErrors && phoneMissing
              ? t("phoneRequired")
              : ""}
        </p>
      </div>

      {/* Email ------------------------------------------------------------ */}
      {BOOKING_FORM.email && (
        <div>
          <Label htmlFor={emailId}>{t("emailLabel")}</Label>
          <Input
            id={emailId}
            className="mt-2"
            type="email"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={(event) => patch({ customerEmail: event.target.value })}
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            invalid={emailInvalid}
            aria-describedby={emailInvalid ? `${emailId}-error` : undefined}
          />
          <p
            id={`${emailId}-error`}
            role="alert"
            aria-live="polite"
            className="text-sm font-semibold text-danger empty:hidden"
          >
            {emailInvalid ? t("emailError") : ""}
          </p>
          <p className="text-muted-2 mt-1 text-sm">{t("emailHint")}</p>
        </div>
      )}

      {/* Verification (SRS 3.5) ------------------------------------------- */}
      {BOOKING_FORM.phoneVerification && (
        <div className="border-border rounded-2xl border p-4">
          <h4 className="text-ink mb-2 text-sm font-bold">
            {t("verifyHeading")}
          </h4>
          <OtpField
            // Remount when the number changes, discarding any code in progress.
            key={e164 ?? "no-phone"}
            phone={e164}
            locale={locale}
            verifiedPhone={draft.verifiedPhone}
            onVerified={(phone) => patch({ verifiedPhone: phone })}
          />
          {verified && (
            <button
              type="button"
              onClick={() =>
                // Drop the record of what was verified, which re-opens the field.
                patch({ verifiedPhone: undefined })
              }
              className="text-muted hover:text-ink mt-3 min-h-11 text-sm font-semibold underline"
            >
              {t("changeNumber")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

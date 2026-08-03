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
  verificationTargetValue,
} from "@/lib/booking/schema";
import { BOOKING_FORM } from "@/lib/booking/formConfig";
import { Link } from "@/i18n/navigation";
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
  const tErrors = useTranslations("booking.errors");
  const { draft, patch, locale } = useBooking();

  const nameId = useId();
  const dialId = useId();
  const phoneId = useId();
  const emailId = useId();
  const termsId = useId();
  const termsErrorId = `${termsId}-error`;
  const phoneHintId = `${phoneId}-hint`;

  const name = draft.customerName ?? "";
  const dial = draft.dialCode ?? DEFAULT_DIAL_CODE;
  const national = draft.phoneNational ?? "";
  const email = draft.customerEmail ?? "";

  const nameTooShort = name.trim().length < 2;
  // Only complain about a partly-typed number once there is something to judge.
  const phoneInvalid = national.trim() !== "" && !toE164(dial, national);
  const phoneMissing = national.trim() === "";
  // Malformed, OR empty now that the field is required. `showErrors` gates
  // when this becomes visible, so it does not shout at a field nobody has
  // reached yet.
  const emailInvalid =
    email.trim() === ""
      ? BOOKING_FORM.email
      : !z.string().email().safeParse(email.trim()).success;

  const e164 = toE164(dial, national);
  const verified = isPhoneVerified(draft);
  // The contact the active channel proves. Null while it is incomplete, which
  // is what disables the "send code" button rather than sending to nothing.
  const otpDestination = verificationTargetValue(draft);

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
            // Locked once verified, so the proven number cannot drift out from
            // under the token — but ONLY when the phone is what was proven.
            // With the email channel live, locking this field would freeze a
            // value nobody had verified.
            readOnly={verified && draft.otpTarget === "phone"}
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
          <Label htmlFor={emailId} required>
            {t("emailLabel")}
          </Label>
          {/* Says WHY it is being asked for. An email field on a form that
              otherwise runs on WhatsApp reads as marketing capture unless the
              reason is on screen. */}
          <p className="text-muted-2 mt-1 mb-2 text-sm">{t("emailHint")}</p>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={(event) => patch({ customerEmail: event.target.value })}
            readOnly={verified && draft.otpTarget !== "phone"}
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            invalid={showErrors && emailInvalid}
            aria-describedby={
              showErrors && emailInvalid ? `${emailId}-error` : undefined
            }
          />
          <p
            id={`${emailId}-error`}
            role="alert"
            aria-live="polite"
            className="text-sm font-semibold text-danger empty:hidden"
          >
            {showErrors && emailInvalid
              ? email.trim() === ""
                ? tErrors("needEmail")
                : t("emailError")
              : ""}
          </p>
        </div>
      )}

      {/* Verification (SRS 3.5) ------------------------------------------- */}
      {BOOKING_FORM.phoneVerification && (
        <div className="border-border rounded-2xl border p-4">
          <h4 className="text-ink mb-2 text-sm font-bold">
            {draft.otpTarget === "phone"
              ? t("verifyHeading")
              : t("verifyHeadingEmail")}
          </h4>
          <OtpField
            // Remount when the contact changes, discarding any code in
            // progress. Keyed on the value being verified, which is the email
            // or the phone depending on the active channel.
            key={otpDestination ?? "no-contact"}
            destination={otpDestination}
            target={draft.otpTarget === "phone" ? "phone" : "email"}
            locale={locale}
            verifiedContact={draft.verifiedPhone}
            onVerified={(contact) => patch({ verifiedPhone: contact })}
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
              {draft.otpTarget === "phone"
                ? t("changeNumber")
                : t("changeEmail")}
            </button>
          )}
        </div>
      )}

      {/* Terms & conditions ------------------------------------------------
          Rendered only when terms exist. `termsRequired` comes from
          /api/settings, and the hold route asks the database the same question
          — so the tick cannot be hidden while the server insists on it, nor
          shown while the server ignores it. */}
      {draft.termsRequired && (
        <div>
          <label
            htmlFor={termsId}
            className={cn(
              "flex cursor-pointer items-start gap-3",
              // The whole row is the target, not just the 20px box.
              "min-h-11 py-1",
            )}
          >
            <input
              id={termsId}
              type="checkbox"
              checked={draft.termsAccepted === true}
              onChange={(event) =>
                patch({ termsAccepted: event.target.checked })
              }
              aria-describedby={
                showErrors && draft.termsAccepted !== true
                  ? termsErrorId
                  : undefined
              }
              className={cn(
                "accent-accent mt-0.5 size-5 shrink-0 cursor-pointer",
                "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
              )}
            />
            <span className="text-ink text-base">
              {t.rich("termsAgree", {
                link: (chunks) => (
                  // Opens in a new tab on purpose: this is the one link on the
                  // form that must not cost the customer their answers. The
                  // draft survives in sessionStorage either way, but a tab they
                  // can close is less alarming than a navigation away from a
                  // half-finished booking.
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-strong font-semibold underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>

          <p
            id={termsErrorId}
            role="alert"
            aria-live="polite"
            className="text-danger text-sm font-semibold empty:hidden"
          >
            {showErrors && draft.termsAccepted !== true ? t("termsError") : ""}
          </p>
        </div>
      )}
    </div>
  );
}

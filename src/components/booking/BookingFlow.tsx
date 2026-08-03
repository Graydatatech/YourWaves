"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui";
import { qatarToday, type IsoMonth } from "@/lib/dates";
import type { Locale } from "@/lib/booking/format";
import { BookingProvider, useBooking, useIsNarrow } from "./BookingProvider";
import { useAvailability, useSettings } from "./useBookingData";
import { useHold } from "./useHold";
import { useCheckout } from "./useCheckout";
import { HoldPanel } from "./HoldPanel";
import { MobileWizard } from "./MobileWizard";
import { DesktopBooking } from "./DesktopBooking";

/**
 * Chooses the layout and owns the network work.
 *
 * Both /api/settings and /api/availability are the live phase-2 endpoints. There
 * is no fixture data in this flow: if the API is down the section says so rather
 * than showing a calendar built from invented state.
 */
function FlowInner() {
  const locale = useLocale() as Locale;
  const tErrors = useTranslations("booking.errors");
  const narrow = useIsNarrow();
  const { draft, hydrated, goTo, patch } = useBooking();

  const { settings, error: settingsError } = useSettings();

  /**
   * Mirror "do terms exist?" into the draft once settings land.
   *
   * The step validator only sees the draft, and it needs to know whether to
   * insist on the agreement tick. Copying the flag in keeps that decision in
   * one place — the settings endpoint — rather than having the validator and
   * the checkbox each decide for themselves and disagree.
   *
   * Client-only, like `verifiedPhone`: zod strips it on the way to the server,
   * which asks the database directly instead of believing this.
   */
  useEffect(() => {
    if (!settings) return;
    const patchable: Record<string, unknown> = {};
    if (draft.termsRequired !== settings.termsAvailable) {
      patchable.termsRequired = settings.termsAvailable;
    }
    // Which contact the OTP step verifies. Mirrored into the draft for the same
    // reason as termsRequired: the step validator only sees the draft, and the
    // wizard and the server must not disagree about which field is being proved.
    if (draft.otpTarget !== settings.otpTarget) {
      patchable.otpTarget = settings.otpTarget;
    }
    if (Object.keys(patchable).length > 0) patch(patchable);
  }, [settings, draft.termsRequired, draft.otpTarget, patch]);

  // Start on the month of the selected date if there is one, else this month.
  const initialMonth = useMemo<IsoMonth>(
    () => (draft.bookingDate ?? qatarToday()).slice(0, 7),
    // Deliberately only on first render: month is user-navigable thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [month, setMonth] = useState<IsoMonth>(initialMonth);
  const minMonth = useMemo<IsoMonth>(() => qatarToday().slice(0, 7), []);

  const {
    states,
    loading: availabilityLoading,
    error: availabilityError,
    invalidate,
  } = useAvailability(month);

  /**
   * The hold owns the end of the flow now (phase 5). Submitting no longer just
   * validates: it locks the date for settings.hold_minutes, and the customer
   * then has that long to pay.
   *
   * The draft and the hold are persisted SEPARATELY. When a hold lapses the
   * draft is untouched, which is what makes the one-tap retry possible — the
   * recovery screen re-runs create() against inputs that never went anywhere.
   */
  const {
    hold,
    phase: holdPhase,
    error: holdError,
    remaining,
    warning,
    hydrated: holdHydrated,
    create: createHold,
    release: releaseHold,
    forget: forgetHold,
  } = useHold({ ...draft, locale });

  const busy = holdPhase === "creating";

  /**
   * Bring the hold panel into view the moment it appears.
   *
   * This is what lets it live below the form. The panel carries a countdown and
   * the Pay button, so it must never be something the customer has to go
   * looking for — whether it appeared because they just submitted, or because
   * they reloaded the page onto a hold that was already running.
   *
   * Keyed on the phase, so it also fires when a hold lapses into its recovery
   * state; `block: "center"` rather than "start" because the panel is short and
   * centring keeps the form visible around it.
   */
  const holdRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (holdPhase === "none") return;
    holdRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [holdPhase]);

  const onSubmit = useCallback(async () => {
    const ok = await createHold();
    // A refused hold usually means the date moved under us, so drop the cached
    // month before the customer looks at the calendar again.
    if (!ok) invalidate();
  }, [createHold, invalidate]);

  const {
    start: startPay,
    paying,
    error: payError,
  } = useCheckout(hold?.bookingId ?? null, locale);

  const onBackToCalendar = useCallback(() => {
    forgetHold();
    invalidate();
    goTo("date");
  }, [forgetHold, invalidate, goTo]);

  if (settingsError) {
    return (
      <p role="alert" className="text-muted text-base">
        {tErrors("settingsUnavailable")}
      </p>
    );
  }

  // Hold the layout until settings have landed AND sessionStorage has been read
  // AND we know the viewport class. Rendering the desktop layout for a phone for
  // one frame would be a visible jolt on the most important screen in the app.
  if (!settings || !hydrated || !holdHydrated || narrow === null) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-11 w-2/3" />
        <Skeleton className="h-64" />
        <Skeleton lines={3} />
      </div>
    );
  }

  const stepProps = {
    locale,
    settings,
    month,
    onMonthChange: setMonth,
    minMonth,
    states,
    availabilityLoading,
  };

  return (
    <>
      {availabilityError && (
        <p role="alert" className="text-muted mb-4 text-sm">
          {tErrors("availabilityUnavailable")}
        </p>
      )}

      {/* The layout stays mounted while a hold is active. Replacing it would
          take the mobile sticky bar — and therefore the countdown — off screen,
          and would hide the answers the customer may still want to check. */}
      {narrow ? (
        <MobileWizard
          {...stepProps}
          submitting={busy}
          holdActive={holdPhase === "active"}
          holdRemaining={remaining}
          holdWarning={warning}
          onSubmit={onSubmit}
        />
      ) : (
        <DesktopBooking
          {...stepProps}
          submitting={busy}
          holdActive={holdPhase === "active"}
          onSubmit={onSubmit}
        />
      )}

      {/**
       * Hold state — the countdown and the Pay button — sits BELOW the flow,
       * next to the button that produced it.
       *
       * It used to sit above, so that a reload or a language switch showed it
       * first. But that put it behind the customer at the moment it appears:
       * you finish the form at the bottom, submit, and the thing you now have to
       * act on renders off the top of the screen, so it reads as "nothing
       * happened". Being next to the submit button beats being first on the page.
       *
       * The reload case is covered instead by scrolling it into view whenever it
       * appears, which works wherever it sits.
       */}
      {holdPhase !== "none" && (
        <div ref={holdRef} className="mt-6 scroll-mt-24">
          <HoldPanel
            locale={locale}
            phase={holdPhase}
            remaining={remaining}
            warning={warning}
            error={holdError}
            reference={hold?.reference}
            priceTotal={hold?.priceTotal}
            currency={hold?.currency}
            onRetry={onSubmit}
            onRelease={releaseHold}
            onBackToCalendar={onBackToCalendar}
            busy={busy}
            onPay={holdPhase === "active" ? startPay : undefined}
            paying={paying}
            payError={payError}
          />
        </div>
      )}
    </>
  );
}

export function BookingFlow() {
  const locale = useLocale() as "ar" | "en";
  return (
    <BookingProvider locale={locale}>
      <FlowInner />
    </BookingProvider>
  );
}

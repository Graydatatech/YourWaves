"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Draft } from "./BookingProvider";

/**
 * Hold lifecycle and the countdown.
 *
 * The hold is persisted to sessionStorage SEPARATELY from the draft, so a
 * reload or a language switch mid-checkout resumes the same countdown instead of
 * orphaning the hold — and, more importantly, so an expiring hold never takes
 * the customer's answers with it. That separation is what makes the one-tap
 * retry on the recovery screen possible.
 *
 * `holdExpiresAt` is an absolute server timestamp, never a client-side duration.
 * A duration drifts when a tab is suspended or its timers are throttled, and
 * could show time remaining after the server had already released the date.
 * Ticking against an absolute instant means a backgrounded phone wakes up
 * showing the truth.
 *
 * State is a reducer rather than five useStates because these fields are one
 * machine: `phase: "active"` with a null hold, or a countdown still running
 * after expiry, are states that should not be representable.
 */

const HOLD_STORAGE_KEY = "yourwaves.booking.hold.v1";
export const WARN_AT_SECONDS = 60;

export type Hold = {
  bookingId: string;
  reference: string;
  holdExpiresAt: string;
  priceTotal: number;
  currency: string;
};

export type HoldPhase =
  "none" | "creating" | "active" | "expired" | "released" | "error";

export type HoldErrorCode =
  | "DATE_TAKEN"
  | "DATE_BLACKOUT"
  | "DATE_PAST"
  | "DATE_TOO_SOON"
  | "DATE_OUT_OF_RANGE"
  | "INVALID_START_TIME"
  | "SETTINGS_MISSING"
  | "PHONE_NOT_VERIFIED"
  | "VALIDATION_FAILED"
  | "NETWORK";

type State = {
  hold: Hold | null;
  phase: HoldPhase;
  error: HoldErrorCode | null;
  remaining: number;
  hydrated: boolean;
};

type Action =
  | { type: "hydrated"; hold: Hold | null; remaining: number }
  | { type: "creating" }
  | { type: "created"; hold: Hold; remaining: number }
  | { type: "refused"; error: HoldErrorCode }
  | { type: "tick"; remaining: number }
  | { type: "expired" }
  | { type: "released" }
  | { type: "forget" };

const INITIAL: State = {
  hold: null,
  phase: "none",
  error: null,
  remaining: 0,
  hydrated: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrated":
      if (!action.hold) return { ...state, hydrated: true };
      return {
        hold: action.hold,
        // Lapsed while the page was away → straight to recovery.
        phase: action.remaining > 0 ? "active" : "expired",
        error: null,
        remaining: action.remaining,
        hydrated: true,
      };
    case "creating":
      return { ...state, phase: "creating", error: null };
    case "created":
      return {
        hold: action.hold,
        phase: "active",
        error: null,
        remaining: action.remaining,
        hydrated: true,
      };
    case "refused":
      return { ...state, phase: "error", error: action.error };
    case "tick":
      if (state.phase !== "active") return state;
      return action.remaining > 0
        ? { ...state, remaining: action.remaining }
        : { ...state, phase: "expired", remaining: 0 };
    case "expired":
      return { ...state, phase: "expired", remaining: 0 };
    case "released":
      return { ...INITIAL, phase: "released", hydrated: true };
    case "forget":
      return { ...INITIAL, hydrated: true };
    default:
      return state;
  }
}

function readStored(): Hold | null {
  try {
    const raw = sessionStorage.getItem(HOLD_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Hold) : null;
  } catch {
    return null;
  }
}

function writeStored(hold: Hold | null) {
  try {
    if (hold) sessionStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify(hold));
    else sessionStorage.removeItem(HOLD_STORAGE_KEY);
  } catch {
    // Private mode; the hold still works for this page view.
  }
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

export function useHold(draft: Draft) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Resume an existing hold. Runs after mount because sessionStorage does not
  // exist during server rendering.
  useEffect(() => {
    const stored = readStored();
    dispatch({
      type: "hydrated",
      hold: stored,
      remaining: stored ? secondsUntil(stored.holdExpiresAt) : 0,
    });
  }, []);

  // Tick against the absolute expiry.
  const expiresAt = state.phase === "active" ? state.hold?.holdExpiresAt : null;

  useEffect(() => {
    if (!expiresAt) return;

    const tick = () =>
      dispatch({ type: "tick", remaining: secondsUntil(expiresAt) });

    const timer = window.setInterval(tick, 1000);

    // A backgrounded tab has its timers throttled, so re-check on return rather
    // than trusting the interval to have kept count.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt]);

  const inFlight = useRef(false);

  /** Claims the date. Calling it again after an expiry IS the retry. */
  const create = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    dispatch({ type: "creating" });

    try {
      const response = await fetch("/api/bookings/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));

      if (response.status === 201 && body?.ok) {
        const hold: Hold = {
          bookingId: body.bookingId,
          reference: body.reference,
          holdExpiresAt: body.holdExpiresAt,
          priceTotal: body.priceTotal,
          currency: body.currency,
        };
        writeStored(hold);
        dispatch({
          type: "created",
          hold,
          remaining: secondsUntil(hold.holdExpiresAt),
        });
        return true;
      }

      const code: HoldErrorCode =
        body?.error === "phone_not_verified"
          ? "PHONE_NOT_VERIFIED"
          : body?.error === "validation_failed"
            ? "VALIDATION_FAILED"
            : typeof body?.code === "string"
              ? (body.code as HoldErrorCode)
              : "DATE_TAKEN";
      dispatch({ type: "refused", error: code });
      return false;
    } catch {
      dispatch({ type: "refused", error: "NETWORK" });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [draft]);

  /** Customer backed out. Best effort: a failure just means it will lapse. */
  const release = useCallback(async () => {
    const current = state.hold;
    if (!current) return;
    try {
      await fetch(`/api/bookings/${current.bookingId}/release`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // The hold_minutes expiry is the backstop.
    }
    writeStored(null);
    dispatch({ type: "released" });
  }, [state.hold]);

  /** Clears local hold state without touching the server (post-expiry). */
  const forget = useCallback(() => {
    writeStored(null);
    dispatch({ type: "forget" });
  }, []);

  return {
    hold: state.hold,
    phase: state.phase,
    error: state.error,
    remaining: state.remaining,
    hydrated: state.hydrated,
    warning:
      state.phase === "active" &&
      state.remaining > 0 &&
      state.remaining <= WARN_AT_SECONDS,
    create,
    release,
    forget,
  };
}

/** mm:ss for the countdown. */
export function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { DraftState, StepError, StepKey } from "@/lib/booking/schema";
import {
  DEFAULT_DIAL_CODE,
  STEP_ORDER,
  visibleSteps,
  stepValidators,
} from "@/lib/booking/schema";

/**
 * Booking wizard state, persisted to sessionStorage.
 *
 * SRS 3.1 requires the form to survive a language toggle. The locale switcher
 * is a real navigation to /ar or /en, which unmounts the whole React tree — so
 * in-memory state cannot survive it and React state alone is not enough.
 * sessionStorage does survive, and additionally survives a tab reload, which
 * covers the "half-filled form" case too.
 *
 * The current STEP is persisted alongside the field values, so a mid-wizard
 * language switch returns the user to the step they were on rather than the
 * start.
 *
 * sessionStorage rather than localStorage on purpose: a booking draft is
 * session-scoped, and leaving a stranger's address in a shared browser
 * indefinitely is not acceptable.
 */

const STORAGE_KEY = "yourwaves.booking.draft.v1";

/**
 * The wizard's working state. Includes the client-only `verifiedPhone` — see
 * DraftState in src/lib/booking/schema.ts for why that never reaches the server.
 */
export type Draft = DraftState;

type State = {
  draft: Draft;
  step: StepKey;
  /** True once sessionStorage has been read; gates the first write. */
  hydrated: boolean;
  /** Steps the user has attempted to leave — controls when errors show. */
  touched: Partial<Record<StepKey, boolean>>;
};

type Action =
  | { type: "hydrate"; state: Pick<State, "draft" | "step" | "touched"> }
  | { type: "hydrateEmpty" }
  | { type: "patch"; patch: Draft }
  | { type: "setStep"; step: StepKey }
  | { type: "touch"; step: StepKey }
  | { type: "reset" };

const INITIAL: State = {
  draft: { dialCode: DEFAULT_DIAL_CODE },
  step: "date",
  hydrated: false,
  touched: {},
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.state, hydrated: true };
    case "hydrateEmpty":
      return { ...state, hydrated: true };
    case "patch":
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case "setStep":
      return { ...state, step: action.step };
    case "touch":
      return { ...state, touched: { ...state.touched, [action.step]: true } };
    case "reset":
      return { ...INITIAL, hydrated: true };
    default:
      return state;
  }
}

type BookingContextValue = {
  draft: Draft;
  /** Active locale, mirrored from the URL. */
  locale: "ar" | "en";
  step: StepKey;
  stepIndex: number;
  /**
   * The steps this draft walks — STEP_ORDER minus any that do not apply.
   * Everything that renders or counts steps must read this, not STEP_ORDER.
   */
  steps: readonly StepKey[];
  hydrated: boolean;
  /** Merge fields into the draft. */
  patch: (patch: Draft) => void;
  goTo: (step: StepKey) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
  /** null when the step is complete, otherwise a `booking.errors.*` key. */
  errorFor: (step: StepKey) => StepError | null;
  /** Whether that error should be shown yet. */
  showErrorFor: (step: StepKey) => boolean;
  isStepComplete: (step: StepKey) => boolean;
  allComplete: boolean;
};

const BookingContext = createContext<BookingContextValue | null>(null);

export function BookingProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: "ar" | "en";
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Read persisted state after mount. Doing this during render would produce a
  // server/client HTML mismatch, since the server has no sessionStorage.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        dispatch({ type: "hydrateEmpty" });
        return;
      }
      const parsed = JSON.parse(raw) as {
        draft?: Draft;
        step?: StepKey;
        touched?: Partial<Record<StepKey, boolean>>;
      };
      dispatch({
        type: "hydrate",
        state: {
          draft: { dialCode: DEFAULT_DIAL_CODE, ...(parsed.draft ?? {}) },
          step: STEP_ORDER.includes(parsed.step as StepKey)
            ? (parsed.step as StepKey)
            : "date",
          touched: parsed.touched ?? {},
        },
      });
    } catch {
      // Corrupt or unavailable storage (private mode) — carry on in memory.
      dispatch({ type: "hydrateEmpty" });
    }
  }, []);

  // Persist. Guarded on `hydrated` so the empty initial state cannot overwrite
  // a stored draft during the first render pass.
  useEffect(() => {
    if (!state.hydrated) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          draft: state.draft,
          step: state.step,
          touched: state.touched,
        }),
      );
    } catch {
      // Storage full or blocked; the flow still works for this page view.
    }
  }, [state.hydrated, state.draft, state.step, state.touched]);

  // Keep `locale` in the draft in step with the URL. This is the language every
  // notification for this booking will use, so it must reflect the language the
  // customer actually finished the form in — including after a mid-flow switch.
  useEffect(() => {
    if (!state.hydrated) return;
    if (state.draft.locale !== locale) {
      dispatch({ type: "patch", patch: { locale } });
    }
  }, [locale, state.hydrated, state.draft.locale]);

  const patch = useCallback(
    (p: Draft) => dispatch({ type: "patch", patch: p }),
    [],
  );
  const goTo = useCallback(
    (step: StepKey) => dispatch({ type: "setStep", step }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const steps = useMemo(() => visibleSteps(state.draft), [state.draft]);

  /**
   * -1 when the current step is not in the visible list, which happens for one
   * render if terms stop being required while the customer is standing on that
   * step. next() and back() both treat it as "start of the list", so they
   * cannot strand anybody on a screen the progress bar no longer shows.
   */
  const stepIndex = steps.indexOf(state.step);

  const errorFor = useCallback(
    (step: StepKey) => stepValidators[step](state.draft),
    [state.draft],
  );

  const isStepComplete = useCallback(
    (step: StepKey) => stepValidators[step](state.draft) === null,
    [state.draft],
  );

  const next = useCallback(() => {
    const current = steps[stepIndex];
    if (!current) return;
    // Mark touched so the inline reason appears if they are blocked.
    dispatch({ type: "touch", step: current });
    if (stepValidators[current](state.draft) !== null) return;
    const following = steps[stepIndex + 1];
    if (following) dispatch({ type: "setStep", step: following });
  }, [steps, stepIndex, state.draft]);

  const back = useCallback(() => {
    const previous = steps[stepIndex - 1];
    if (previous) dispatch({ type: "setStep", step: previous });
  }, [steps, stepIndex]);

  const showErrorFor = useCallback(
    (step: StepKey) => Boolean(state.touched[step]),
    [state.touched],
  );

  const allComplete = useMemo(
    () => steps.every((s) => stepValidators[s](state.draft) === null),
    [steps, state.draft],
  );

  const value = useMemo<BookingContextValue>(
    () => ({
      draft: state.draft,
      locale,
      step: state.step,
      stepIndex,
      steps,
      hydrated: state.hydrated,
      patch,
      goTo,
      next,
      back,
      reset,
      errorFor,
      showErrorFor,
      isStepComplete,
      allComplete,
    }),
    [
      state.draft,
      locale,
      state.step,
      state.hydrated,
      stepIndex,
      steps,
      patch,
      goTo,
      next,
      back,
      reset,
      errorFor,
      showErrorFor,
      isStepComplete,
      allComplete,
    ],
  );

  return (
    <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
  );
}

export function useBooking(): BookingContextValue {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBooking must be used inside <BookingProvider>");
  }
  return context;
}

/** Clears the persisted draft — call after a successful submission. */
export function clearStoredDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Tracks whether the viewport is below the 900px `wide` breakpoint.
 *
 * Returns `null` until mounted so callers can avoid rendering either layout
 * during hydration — picking one on the server would guarantee a mismatch for
 * half of all visitors.
 */
export function useIsNarrow(): boolean | null {
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 899.98px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
}

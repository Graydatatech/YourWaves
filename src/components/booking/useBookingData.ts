"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DayState } from "@/lib/availability";
import type { IsoDate, IsoMonth } from "@/lib/dates";
import { toServiceAreas, type ServiceArea } from "@/lib/booking/serviceArea";

/**
 * Reads the live phase-2 endpoints. There is no mock data anywhere in this flow.
 *
 * Availability is fetched per month and cached in memory for the page view, so
 * paging back and forth does not re-hit the network. The endpoint itself is
 * additionally edge-cached for 30s with stale-while-revalidate.
 */

export type PublicSettings = {
  currency: string;
  pricing: {
    rental: number;
    setup: number;
    delivery: number;
    total: number;
  };
  availableStartTimes: string[];
  leadTimeHours: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  serviceAreas: ServiceArea[];
  /** True when terms exist to agree to. The tick is hidden when they do not. */
  termsAvailable: boolean;
  timeZone: string;
};

export function useSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((response) => {
        if (!response.ok) throw new Error(`settings ${response.status}`);
        return response.json();
      })
      .then((data: PublicSettings) => {
        // An edge-cached response from before 0012 still holds plain strings;
        // normalising here means a stale cache costs a fallback label, not a
        // crashed booking form.
        if (!cancelled) {
          setSettings({
            ...data,
            serviceAreas: toServiceAreas(data.serviceAreas),
            termsAvailable: data.termsAvailable === true,
          });
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { settings, error };
}

type AvailabilityResponse = {
  month: IsoMonth;
  today: IsoDate;
  timeZone: string;
  days: { date: IsoDate; state: DayState }[];
};

export function useAvailability(month: IsoMonth) {
  const cache = useRef(new Map<IsoMonth, Map<IsoDate, DayState>>());
  const [states, setStates] = useState<Map<IsoDate, DayState>>(new Map());
  const [today, setToday] = useState<IsoDate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: IsoMonth, signal?: AbortSignal) => {
    const cached = cache.current.get(target);
    if (cached) {
      setStates(cached);
      setLoading(false);
      return;
    }
    // Drop the previous month's map before fetching. Keeping it would leave the
    // calendar holding states keyed to dates no longer on screen, so every day
    // of the NEW month would miss the lookup and render as unavailable until
    // the response landed — a whole month that looks fully booked.
    setStates(new Map());
    setLoading(true);
    try {
      const response = await fetch(`/api/availability?month=${target}`, {
        signal,
      });
      if (!response.ok) throw new Error(`availability ${response.status}`);
      const data: AvailabilityResponse = await response.json();
      const map = new Map<IsoDate, DayState>(
        data.days.map((day) => [day.date, day.state]),
      );
      cache.current.set(target, map);
      setStates(map);
      setToday(data.today);
      setError(null);
    } catch (cause) {
      if ((cause as Error).name === "AbortError") return;
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(month, controller.signal);
    return () => controller.abort();
  }, [month, load]);

  /** Drops the cache so the next read is fresh — used after a submission. */
  const invalidate = useCallback(() => {
    cache.current.clear();
  }, []);

  return { states, today, loading, error, invalidate };
}

"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui";

/**
 * Defers the booking wizard's JavaScript until the customer is on their way to
 * it.
 *
 * The wizard is by far the largest client component on the marketing page — the
 * whole provider, calendar, time picker, location step, OTP field, hold
 * countdown and checkout hook — and none of it is needed to render, read or
 * scroll the page it lives at the bottom of. Shipping it in the initial payload
 * meant the hero and header could not hydrate until it had all arrived, which
 * on the 4G budget in CLAUDE.md is the difference the phase-10 brief is about.
 *
 * Two triggers, whichever fires first:
 *
 *   1. An IntersectionObserver with 800px of rootMargin. 800px is roughly one
 *      phone screen of warning, so on a normal scroll the chunk is already in
 *      flight — and usually parsed — before the section is on screen. The
 *      customer never waits on it.
 *   2. requestIdleCallback. This is what covers the paths the observer cannot
 *      see: a #booking deep link, the header CTA, and Safari, whose observer
 *      fires late enough on a long page to be worth not relying on alone.
 *
 * Both are cheap and idempotent — whichever wins flips one boolean.
 *
 * WHAT THIS IS NOT: it is not `ssr: false`. The wizard renders its own skeleton
 * until settings and sessionStorage have landed (see BookingFlow), so there is
 * no server HTML worth keeping, but the section HEADING above it is a Server
 * Component and still renders on the server. The placeholder below reserves the
 * same box the skeleton occupies, so nothing moves when the real thing arrives.
 */
const BookingFlow = dynamic(
  () => import("./BookingFlow").then((mod) => mod.BookingFlow),
  { ssr: false },
);

export function BookingFlowLazy() {
  const t = useTranslations("booking");
  const [load, setLoad] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (load) return;

    const start = () => setLoad(true);

    // --- Trigger 1: approaching the viewport -----------------------------
    let observer: IntersectionObserver | undefined;
    const node = anchorRef.current;
    if (node && typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) start();
        },
        { rootMargin: "800px 0px" },
      );
      observer.observe(node);
    } else {
      // No observer support at all: do not gamble, load it now.
      start();
    }

    // --- Trigger 2: the main thread went quiet ---------------------------
    const idle = window.requestIdleCallback;
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (typeof idle === "function") {
      idleId = idle.call(window, start, { timeout: 4000 });
    } else {
      timeoutId = window.setTimeout(start, 2500);
    }

    return () => {
      observer?.disconnect();
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [load]);

  if (load) return <BookingFlow />;

  return (
    <div ref={anchorRef} aria-busy="true" className="space-y-4">
      {/* Announced once, so a screen-reader user who lands here by deep link is
          told the form is coming rather than meeting three silent grey bars. */}
      <p className="sr-only" role="status">
        {t("loading")}
      </p>
      <Skeleton className="h-11 w-2/3" />
      <Skeleton className="h-64" />
      <Skeleton lines={3} />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const THRESHOLD = 72;
const MAX_PULL = 110;

/**
 * Pull-to-refresh for the list screens.
 *
 * The gesture is what an ops person will try first on a phone — the data is
 * live and they are checking whether a driver has moved. Without it they hunt
 * for a button, or reload the whole document and lose their filters.
 *
 * Only engages when the page is ALREADY at the top and the drag is downward.
 * Otherwise this would fight normal scrolling, which is far worse than not
 * having the gesture at all. Touch only: a mouse has a scrollbar and a keyboard
 * has the refresh button, both of which already work.
 *
 * `router.refresh()` re-runs the Server Component and swaps the payload in
 * place, so filters, scroll position and any open sheet survive.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    function onTouchStart(event: TouchEvent) {
      if (window.scrollY > 0 || refreshing) {
        armed.current = false;
        return;
      }
      armed.current = true;
      startY.current = event.touches[0].clientY;
    }

    function onTouchMove(event: TouchEvent) {
      if (!armed.current || startY.current === null) return;

      const delta = event.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }

      // Resistance, so the sheet does not track the finger 1:1 and feel loose.
      setPull(Math.min(delta * 0.5, MAX_PULL));
    }

    async function onTouchEnd() {
      if (!armed.current) return;
      armed.current = false;

      const shouldRefresh = pull >= THRESHOLD;
      setPull(0);
      startY.current = null;

      if (!shouldRefresh) return;

      setRefreshing(true);
      router.refresh();
      // No completion signal exists for router.refresh(), so the indicator is
      // held briefly rather than flashing off before the new payload paints.
      window.setTimeout(() => setRefreshing(false), 700);
    }

    // Passive: this never calls preventDefault, so it must not tell the browser
    // it might — that would disable scroll optimisation on every touch.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing, router]);

  const active = refreshing || pull > 0;

  return (
    <div className="relative">
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none flex items-center justify-center overflow-hidden",
          "text-muted-2 text-xs font-semibold transition-[height] duration-150",
        )}
        style={{ height: refreshing ? 36 : pull }}
      >
        {active ? (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "border-accent size-3.5 rounded-full border-2 border-t-transparent",
                refreshing && "motion-safe:animate-spin",
              )}
            />
            {refreshing
              ? t("common.refreshing")
              : pull >= THRESHOLD
                ? t("common.releaseToRefresh")
                : t("common.pullToRefresh")}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

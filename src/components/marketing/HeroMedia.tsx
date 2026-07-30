"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Minimal shape of the Network Information API, which TypeScript's DOM lib
 * does not yet declare. Chrome/Android expose it; Safari does not, and the
 * absence is handled as "unknown, assume acceptable".
 */
type NetworkInformation = {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
};

const BLOCKED_CONNECTIONS = new Set(["slow-2g", "2g"]);

/**
 * Decides whether it is reasonable to pull a multi-megabyte video.
 * Deliberately conservative: anything that looks like a slow link, an explicit
 * data-saver preference, or a reduced-motion preference means poster only.
 */
function shouldLoadVideo(): boolean {
  if (typeof window === "undefined") return false;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;

  if (!connection) return true; // Unknown (e.g. Safari) — allow.
  if (connection.saveData) return false;
  if (
    connection.effectiveType &&
    BLOCKED_CONNECTIONS.has(connection.effectiveType)
  ) {
    return false;
  }
  return true;
}

export type HeroMediaProps = {
  /** Public path to the looping clip. Absent file simply means poster-only. */
  src: string;
};

/**
 * Progressive enhancement over the hero poster.
 *
 * The poster is rendered by the server as a `next/image` with `priority`, so it
 * is the LCP candidate and paints without waiting for any JavaScript. This
 * component mounts *after* hydration, and only then decides whether to fetch
 * the video at all. The <video> is faded in on `canplaythrough`, so the user
 * never sees a half-buffered frame or a flash of black.
 *
 * Net effect on a 4G phone: first paint is a ~30KB AVIF poster; the video is a
 * later, optional upgrade that cannot delay LCP.
 */
export function HeroMedia({ src }: HeroMediaProps) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Gate the decision behind an idle callback so it never competes with the
  // poster paint for main-thread time.
  useEffect(() => {
    const decide = () => setEnabled(shouldLoadVideo());

    // Read the API off a local alias: `"x" in window` narrows `window` itself,
    // which makes the fallback branch `never` under strict mode.
    const idle = window.requestIdleCallback;

    if (typeof idle === "function") {
      const id = idle.call(window, decide, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(decide, 1200);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;

    const onReady = () => {
      setReady(true);
      // play() can reject (autoplay policy); poster stays, which is fine.
      void video.play().catch(() => setReady(false));
    };

    video.addEventListener("canplaythrough", onReady, { once: true });
    // The element is rendered with preload="none"; this is what starts the fetch.
    video.load();

    return () => video.removeEventListener("canplaythrough", onReady);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <video
      ref={videoRef}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      className={[
        "absolute inset-0 size-full object-cover",
        "transition-opacity duration-700 motion-reduce:transition-none",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}

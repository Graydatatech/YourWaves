/**
 * Lazy loader for the Google Maps JavaScript API.
 *
 * The script is ~200KB and is only ever needed if the customer actually taps
 * "pick on map", so it is loaded on demand rather than on page load — the whole
 * point of the 4G budget in CLAUDE.md.
 *
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is read at build time. When it is absent the
 * loader reports `unavailable` and the location step hides the map affordance
 * entirely rather than offering a button that cannot work. Address entry,
 * geolocation and the maps-link field all function without a key.
 */

export type MapsLoadState = "unavailable" | "loading" | "ready" | "error";

const CALLBACK = "__yourwavesMapsReady";

let loadPromise: Promise<void> | null = null;

export function mapsApiKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return key && key.trim() !== "" ? key : undefined;
}

export function isMapsConfigured(): boolean {
  return mapsApiKey() !== undefined;
}

/**
 * Injects the Maps script once and resolves when the API is usable.
 * Repeated calls share the same promise.
 */
export function loadGoogleMaps(language: "ar" | "en"): Promise<void> {
  if (loadPromise) return loadPromise;

  const key = mapsApiKey();
  if (!key) {
    return Promise.reject(new Error("maps_not_configured"));
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("maps_requires_browser"));
      return;
    }

    // Already present from an earlier mount.
    const existing = (window as unknown as { google?: { maps?: unknown } })
      .google?.maps;
    if (existing) {
      resolve();
      return;
    }

    const globals = window as unknown as Record<string, unknown>;
    globals[CALLBACK] = () => {
      delete globals[CALLBACK];
      resolve();
    };

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      // `marker` is needed for AdvancedMarkerElement; `geocoding` for the
      // reverse lookup that turns a dropped pin into a readable address.
      libraries: "marker,geocoding",
      language,
      region: "QA",
      loading: "async",
      callback: CALLBACK,
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("maps_script_failed"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Doha, used as the initial map centre when we have no better guess. */
export const DOHA_CENTER = { lat: 25.2854, lng: 51.531 } as const;

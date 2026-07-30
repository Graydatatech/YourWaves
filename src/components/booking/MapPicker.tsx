"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sheet, Button } from "@/components/ui";
import { DOHA_CENTER, loadGoogleMaps } from "@/lib/booking/googleMaps";

export type PickedLocation = {
  lat: number;
  lng: number;
  /** Reverse-geocoded address, when Google could resolve one. */
  address?: string;
};

export type MapPickerProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (location: PickedLocation) => void;
  locale: "ar" | "en";
  /** Existing pin, if the customer is adjusting rather than setting. */
  initial?: { lat: number; lng: number };
};

type Phase = "loading" | "ready" | "error";

/**
 * The map itself, mounted only while the sheet is open.
 *
 * Splitting this out of MapPicker is what lets `phase` start at "loading" in
 * useState rather than being pushed there by an effect — reopening the sheet
 * mounts a fresh component, so there is no stale "error" to clear and no
 * state-sync effect to get wrong.
 */
function MapCanvas({
  locale,
  initial,
  onPick,
  onPhase,
}: {
  locale: "ar" | "en";
  initial?: { lat: number; lng: number };
  onPick: (location: PickedLocation) => void;
  onPhase: (phase: Phase) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps(locale)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const start = initial ?? DOHA_CENTER;
        const map = new google.maps.Map(containerRef.current, {
          center: start,
          zoom: initial ? 16 : 11,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });

        const marker = new google.maps.Marker({
          map,
          position: start,
          draggable: true,
        });
        const geocoder = new google.maps.Geocoder();

        const commit = (position: google.maps.LatLng | null | undefined) => {
          if (!position) return;
          const next = { lat: position.lat(), lng: position.lng() };
          // Report the coordinates immediately; the address is a bonus that
          // arrives later and may not arrive at all.
          onPick(next);
          geocoder.geocode({ location: next }, (results, code) => {
            if (cancelled) return;
            if (code === "OK" && results?.[0]) {
              onPick({ ...next, address: results[0].formatted_address });
            }
          });
        };

        marker.addListener("dragend", () => commit(marker.getPosition()));
        map.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          marker.setPosition(event.latLng);
          commit(event.latLng);
        });

        commit(new google.maps.LatLng(start.lat, start.lng));
        onPhase("ready");
      })
      .catch(() => {
        if (!cancelled) onPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [locale, initial, onPick, onPhase]);

  return <div ref={containerRef} className="bg-ink/5 absolute inset-0" />;
}

/**
 * Full-screen map with a draggable pin.
 *
 * Rendered in the `full` Sheet variant on every viewport rather than an inline
 * 190px box: choosing a spot on a map is a precision task and a small embedded
 * canvas is unusable on a phone. Confirmation is explicit — the pin is only
 * committed when the customer taps confirm, so a stray drag cannot silently
 * change their address.
 *
 * NOTE: written against the documented Maps JS API but NOT exercised against a
 * live key — none is configured in this project yet. The surrounding flow does
 * not depend on it: address entry and geolocation both work without Maps.
 */
export function MapPicker({
  open,
  onClose,
  onConfirm,
  locale,
  initial,
}: MapPickerProps) {
  const t = useTranslations("booking.location");
  const [phase, setPhase] = useState<Phase>("loading");
  const [picked, setPicked] = useState<PickedLocation | null>(null);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="full"
      label={t("mapTitle")}
      className="px-0"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pb-3">
          <h2 className="text-ink text-lg font-bold">{t("mapTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("mapClose")}
            className="tap-target text-muted hover:bg-ink/5 -me-2 grid place-items-center rounded-full"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
              <path
                d="M3 3l10 10M13 3L3 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="relative flex-1">
          {open && (
            <MapCanvas
              locale={locale}
              initial={initial}
              onPick={setPicked}
              onPhase={setPhase}
            />
          )}

          {phase !== "ready" && (
            <div
              className="absolute inset-0 grid place-items-center px-6 text-center"
              role="status"
            >
              <p className="text-muted text-base">
                {phase === "error" ? t("mapError") : t("mapLoading")}
              </p>
            </div>
          )}
        </div>

        <div className="border-border space-y-3 border-t px-5 pt-4">
          <p className="text-muted text-sm">
            {picked?.address ?? t("mapHint")}
          </p>
          <Button
            fullWidth
            size="lg"
            disabled={phase !== "ready" || !picked}
            onClick={() => {
              if (picked) onConfirm(picked);
              onClose();
            }}
          >
            {t("mapConfirm")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

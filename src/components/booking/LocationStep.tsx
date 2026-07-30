"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Input, Label, Pill } from "@/components/ui";
import { isMapsUrl } from "@/lib/booking/schema";
import { BOOKING_FORM } from "@/lib/booking/formConfig";
import { areaLabel, type ServiceArea } from "@/lib/booking/serviceArea";
import { isMapsConfigured } from "@/lib/booking/googleMaps";
import { MapPicker, type PickedLocation } from "./MapPicker";
import { useBooking } from "./BookingProvider";

export type LocationStepProps = {
  locale: "ar" | "en";
  /** settings.service_areas — quick-pick chips, labelled in the reader's language. */
  serviceAreas: ServiceArea[];
  showErrors: boolean;
};

type GeoState = "idle" | "asking" | "ok" | "denied" | "unsupported";

/**
 * Address, optional map pin, and area quick-picks.
 *
 * Geolocation is requested ONLY from the tap handler. Calling
 * getCurrentPosition on mount triggers the browser's permission prompt before
 * the user has expressed any intent, which most people reflexively deny —
 * poisoning the permission for the rest of the session.
 */
export function LocationStep({
  locale,
  serviceAreas,
  showErrors,
}: LocationStepProps) {
  const t = useTranslations("booking.location");
  const { draft, patch } = useBooking();
  const [mapOpen, setMapOpen] = useState(false);
  const [geo, setGeo] = useState<GeoState>("idle");

  const addressId = useId();
  const mapsUrlId = useId();
  const notesId = useId();
  const addressErrorId = `${addressId}-error`;
  const mapsUrlErrorId = `${mapsUrlId}-error`;

  const address = draft.addressLine ?? "";
  const mapsUrl = draft.mapsUrl ?? "";
  const addressTooShort = address.trim().length < 10;
  const mapsUrlInvalid = mapsUrl.trim() !== "" && !isMapsUrl(mapsUrl);

  const mapsAvailable = isMapsConfigured();

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setGeo("unsupported");
      return;
    }
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        patch({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
        setGeo("ok");
      },
      () => setGeo("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function onMapConfirm(picked: PickedLocation) {
    patch({
      lat: Number(picked.lat.toFixed(6)),
      lng: Number(picked.lng.toFixed(6)),
      // Only fill the address if the customer has not written their own.
      ...(picked.address && address.trim() === ""
        ? { addressLine: picked.address }
        : {}),
    });
  }

  const hasPin = draft.lat !== undefined && draft.lng !== undefined;

  return (
    <div className="space-y-6">
      {/* Address ---------------------------------------------------------- */}
      <div>
        <Label htmlFor={addressId} required>
          {t("addressLabel")}
        </Label>
        <p className="text-muted-2 mt-1 mb-2 text-sm">{t("addressHint")}</p>
        <Input
          id={addressId}
          value={address}
          onChange={(event) => patch({ addressLine: event.target.value })}
          placeholder={t("addressPlaceholder")}
          autoComplete="street-address"
          invalid={showErrors && addressTooShort}
          aria-describedby={
            showErrors && addressTooShort ? addressErrorId : undefined
          }
        />
        {/* aria-live so the message is announced when it appears, not only
            discovered by a user who happens to navigate back to the field. */}
        <p
          id={addressErrorId}
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-red-600 empty:hidden"
        >
          {showErrors && addressTooShort ? t("addressError") : ""}
        </p>
      </div>

      {/* Area quick-picks -------------------------------------------------- */}
      {serviceAreas.length > 0 && (
        <fieldset>
          <legend className="text-ink mb-2 block text-sm font-semibold">
            {t("areaLabel")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {serviceAreas.map((area) => {
              // The ENGLISH name is what gets stored — the chip's label follows
              // the reader, the value the back office acts on does not.
              const isSelected = draft.area === area.en;
              return (
                <button
                  key={area.en}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() =>
                    patch({ area: isSelected ? undefined : area.en })
                  }
                  className={cn(
                    "rounded-pill min-h-11 px-4 text-sm font-semibold transition-colors",
                    "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
                    isSelected
                      ? "bg-brand text-ink-deep"
                      : "border-border bg-surface text-muted hover:border-accent/50 border",
                  )}
                >
                  {areaLabel(area, locale)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Pin --------------------------------------------------------------- */}
      {BOOKING_FORM.exactSpot && (
        <div className="space-y-3">
          <span className="text-ink block text-sm font-semibold">
            {t("pinLabel")}
          </span>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={useCurrentLocation}
              className={cn(
                "border-border bg-surface text-ink hover:border-accent/50",
                "rounded-pill inline-flex min-h-11 items-center gap-2 border px-4",
                "text-sm font-semibold transition-colors",
              )}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
                <circle
                  cx="8"
                  cy="8"
                  r="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M8 1v2M8 13v2M1 8h2M13 8h2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              {geo === "asking" ? t("geoAsking") : t("geoUse")}
            </button>

            {mapsAvailable && (
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                className={cn(
                  "border-border bg-surface text-ink hover:border-accent/50",
                  "rounded-pill inline-flex min-h-11 items-center gap-2 border px-4",
                  "text-sm font-semibold transition-colors",
                )}
              >
                {t("pickOnMap")}
              </button>
            )}
          </div>

          {/* Geolocation outcome, announced. */}
          <p role="status" aria-live="polite" className="text-sm empty:hidden">
            {geo === "denied" && (
              <span className="text-muted">{t("geoDenied")}</span>
            )}
            {geo === "unsupported" && (
              <span className="text-muted">{t("geoUnsupported")}</span>
            )}
          </p>

          {hasPin && (
            <div className="flex items-center gap-2">
              <Pill tone="neutral">{t("pinSet")}</Pill>
              <button
                type="button"
                onClick={() => patch({ lat: undefined, lng: undefined })}
                className="text-muted hover:text-ink min-h-11 text-sm font-semibold underline"
              >
                {t("pinClear")}
              </button>
            </div>
          )}

          {!mapsAvailable && (
            <p className="text-muted-2 text-sm">{t("mapUnavailable")}</p>
          )}
        </div>
      )}

      {/* Maps link -------------------------------------------------------- */}
      <div>
        <Label htmlFor={mapsUrlId}>{t("mapsUrlLabel")}</Label>
        <p className="text-muted-2 mt-1 mb-2 text-sm">{t("mapsUrlHint")}</p>
        <Input
          id={mapsUrlId}
          type="url"
          inputMode="url"
          dir="ltr"
          value={mapsUrl}
          onChange={(event) => patch({ mapsUrl: event.target.value })}
          placeholder="https://maps.app.goo.gl/…"
          autoComplete="url"
          invalid={mapsUrlInvalid}
          aria-describedby={mapsUrlInvalid ? mapsUrlErrorId : undefined}
        />
        <p
          id={mapsUrlErrorId}
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-red-600 empty:hidden"
        >
          {mapsUrlInvalid ? t("mapsUrlError") : ""}
        </p>
      </div>

      {/* Notes ------------------------------------------------------------ */}
      {BOOKING_FORM.notes && (
        <div>
          <Label htmlFor={notesId}>{t("notesLabel")}</Label>
          <textarea
            id={notesId}
            value={draft.notes ?? ""}
            onChange={(event) => patch({ notes: event.target.value })}
            rows={3}
            maxLength={500}
            placeholder={t("notesPlaceholder")}
            className={cn(
              "rounded-input border-border bg-surface mt-2 w-full border",
              // 16px minimum: anything smaller makes iOS Safari zoom on focus.
              "text-ink placeholder:text-muted-3 px-4 py-3 text-[16px]",
              "focus-visible:border-accent focus-visible:outline-accent",
              "focus-visible:outline-2 focus-visible:outline-offset-0",
            )}
          />
        </div>
      )}

      {BOOKING_FORM.exactSpot && mapsAvailable && (
        <MapPicker
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          onConfirm={onMapConfirm}
          locale={locale}
          initial={hasPin ? { lat: draft.lat!, lng: draft.lng! } : undefined}
        />
      )}
    </div>
  );
}

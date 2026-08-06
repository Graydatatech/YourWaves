"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Input, Label, Pill } from "@/components/ui";
import { composeAddress, isMapsUrl } from "@/lib/booking/schema";
import { BOOKING_FORM } from "@/lib/booking/formConfig";
import { areaLabel, type ServiceArea } from "@/lib/booking/serviceArea";
import { isMapsConfigured } from "@/lib/booking/googleMaps";
import type { PickedLocation } from "./MapPicker";
import { useBooking } from "./BookingProvider";

/**
 * The map sheet is a separate chunk, fetched the first time the customer taps
 * "pick on map" and never on a page that has no key configured.
 *
 * The Google Maps SDK itself was already lazy (see lib/booking/googleMaps.ts),
 * but MapPicker's own code was not: a static import put it, and the `Sheet`
 * primitive it mounts, into the booking bundle for every visitor — including
 * the majority who type their address and never open a map at all.
 *
 * `ssr: false` because there is nothing to render on the server: the component
 * is a container for a canvas that only exists after the SDK loads. Allowed
 * here, and only here, because this module is already a Client Component.
 *
 * No `loading` fallback: the sheet is what the tap opens, so a placeholder
 * sheet would flash a second empty panel before the real one. MapPicker already
 * renders its own "loading the map" state for exactly this window.
 */
const MapPicker = dynamic(
  () => import("./MapPicker").then((mod) => mod.MapPicker),
  { ssr: false },
);

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
  // Latches on the first open and never resets, so closing the sheet does not
  // unmount the chunk and make a second tap re-fetch it.
  const [mapEverOpened, setMapEverOpened] = useState(false);
  const [geo, setGeo] = useState<GeoState>("idle");

  const buildingId = useId();
  const streetId = useId();
  const zoneId = useId();
  const addressId = useId();
  const mapsUrlId = useId();
  const notesId = useId();
  const addressErrorId = `${addressId}-error`;
  const mapsUrlErrorId = `${mapsUrlId}-error`;

  const building = draft.buildingNo ?? "";
  const street = draft.streetNo ?? "";
  const zone = draft.zoneNo ?? "";
  const address = draft.addressLine ?? "";
  const mapsUrl = draft.mapsUrl ?? "";
  const buildingMissing = building.trim() === "";
  const streetMissing = street.trim() === "";
  const zoneMissing = zone.trim() === "";
  const addressIncomplete = buildingMissing || streetMissing || zoneMissing;

  /**
   * Writes the edited part AND the composed line in ONE patch.
   *
   * Two patches would mean two renders and, worse, a window where the draft
   * held a building number that the address line did not yet mention — and the
   * draft is persisted to sessionStorage on change, so a customer who closed
   * the tab in that window would restore an inconsistent one.
   */
  function patchAddress(part: {
    buildingNo?: string;
    streetNo?: string;
    zoneNo?: string;
  }) {
    const next = { buildingNo: building, streetNo: street, zoneNo: zone, ...part };
    patch({ ...part, addressLine: composeAddress(next) ?? "" });
  }
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
      // The address is composed from three numbered fields now, and a place
      // name from Google does not decompose into them. The pin is still worth
      // having — it is what the driver navigates to — so it is kept and the
      // typed address is left alone rather than overwritten with prose.
    });
  }

  const hasPin = draft.lat !== undefined && draft.lng !== undefined;

  return (
    <div className="space-y-6">
      {/* Address ----------------------------------------------------------
          Three numbered fields, which is how a Qatari address is actually
          given: building, street, zone. A single free-text line collected
          "my villa next to the mosque" often enough that the crew had to phone
          for directions on the day.

          One row of three at every width. They are short numeric fields, so
          they fit side by side even at 320px, and stacking them would push the
          rest of the step below the fold on a phone — the layout §1 exists to
          prevent. `min-w-0` lets the columns actually shrink: a grid track is
          `auto` by default, which refuses to go below the input's intrinsic
          width and overflows the page instead. */}
      <div>
        <Label htmlFor={buildingId} required>
          {t("addressLabel")}
        </Label>
        <p className="text-muted-2 mt-1 mb-2 text-sm">{t("addressHint")}</p>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              {
                id: buildingId,
                part: "building",
                value: building,
                missing: buildingMissing,
                label: t("buildingLabel"),
                placeholder: t("buildingPlaceholder"),
                onChange: (v: string) => patchAddress({ buildingNo: v }),
              },
              {
                id: streetId,
                part: "street",
                value: street,
                missing: streetMissing,
                label: t("streetLabel"),
                placeholder: t("streetPlaceholder"),
                onChange: (v: string) => patchAddress({ streetNo: v }),
              },
              {
                id: zoneId,
                part: "zone",
                value: zone,
                missing: zoneMissing,
                label: t("zoneLabel"),
                placeholder: t("zonePlaceholder"),
                onChange: (v: string) => patchAddress({ zoneNo: v }),
              },
            ] as const
          ).map((field) => (
            <div key={field.id} className="min-w-0">
              <label
                htmlFor={field.id}
                className="text-muted mb-1 block text-xs font-semibold"
              >
                {field.label}
              </label>
              <Input
                id={field.id}
                // A stable hook for pnpm check:booking, which has to find these
                // in a real browser. Autofill is OFF: no standard token means
                // "zone number", and a browser filling "12 Main Street" into a
                // ten-character box is worse help than none.
                data-address-part={field.part}
                autoComplete="off"
                // numeric keypad, but type stays text: a number input strips
                // the leading zeros and letters that real building numbers
                // carry, silently, after the customer has typed them.
                inputMode="numeric"
                type="text"
                dir="ltr"
                maxLength={10}
                // Short numeric values in a narrow column read better centred,
                // and it is the only alignment class here — `cn` is a plain
                // joiner with no tailwind-merge, so anything that collided with
                // the primitive's own padding would resolve unpredictably.
                className="text-center"
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                placeholder={field.placeholder}
                invalid={showErrors && field.missing}
                aria-describedby={
                  showErrors && addressIncomplete ? addressErrorId : undefined
                }
              />
            </div>
          ))}
        </div>

        {/* One message for the row, not three stacked under three boxes —
            each invalid field is already outlined. aria-live so it is
            announced when it appears, not only found by a user who happens
            to navigate back. */}
        <p
          id={addressErrorId}
          role="alert"
          aria-live="polite"
          className="text-sm font-semibold text-danger empty:hidden"
        >
          {showErrors && addressIncomplete ? t("addressError") : ""}
        </p>

        {/* What the driver will be sent, echoed back. The composed line is
            what every downstream reader gets, so showing it here is the only
            place a customer can catch a transposed number before it is on a
            job sheet. */}
        {!addressIncomplete && (
          <p className="text-muted-2 pt-1 text-sm" dir="ltr">
            {address}
          </p>
        )}
      </div>

      {/* Area quick-picks -------------------------------------------------- */}
      {BOOKING_FORM.area && serviceAreas.length > 0 && (
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
                    "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
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
                onClick={() => {
                  setMapEverOpened(true);
                  setMapOpen(true);
                }}
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
          className="text-sm font-semibold text-danger empty:hidden"
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
              "focus-visible:border-accent focus-visible:outline-focus",
              "focus-visible:outline-2 focus-visible:outline-offset-0",
            )}
          />
        </div>
      )}

      {/* Mounted only once the sheet has been opened at least once. Rendering
          it unconditionally with `open={false}` would defeat the dynamic
          import: next/dynamic fetches the chunk when the component ENTERS the
          tree, not when it becomes visible. */}
      {BOOKING_FORM.exactSpot && mapsAvailable && mapEverOpened && (
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

/**
 * A maps link that opens the native app.
 *
 * Not `server-only` and not a component: both the server-rendered booking detail
 * and the client-side today card need it, and it touches nothing but its
 * argument.
 *
 * Order matters. Coordinates are exact and are what a driver actually
 * navigates to, so they win when present. The `?api=1` search URL is claimed by
 * the Google Maps app's universal-link filters on both iOS and Android, so it
 * opens the app when installed and the web map when not — the same link phase 7
 * sends drivers, so what a dispatcher taps and what the driver received resolve
 * to the same pin.
 */
export function buildAdminMapsLink(input: {
  lat?: string | number | null;
  lng?: string | number | null;
  mapsUrl?: string | null;
  addressLine?: string | null;
  area?: string | null;
  city?: string | null;
}): string {
  const lat =
    input.lat !== null && input.lat !== undefined
      ? Number(input.lat)
      : undefined;
  const lng =
    input.lng !== null && input.lng !== undefined
      ? Number(input.lng)
      : undefined;

  if (
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  if (input.mapsUrl) return input.mapsUrl;

  const query = [input.addressLine, input.area, input.city, "Qatar"]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

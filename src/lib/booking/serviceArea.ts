import { z } from "zod";

/**
 * A service area, in both languages.
 *
 * Stored as a jsonb array of these on `settings.service_areas` (migration
 * 0012). The ENGLISH name is canonical: it is what goes into `bookings.area`,
 * and therefore what the back office lists, what a dispatch job sheet shows a
 * driver, and what an ops person says on the phone. Only the label a customer
 * reads follows their locale — the value the business acts on does not move.
 */
export type ServiceArea = {
  en: string;
  ar: string;
};

export const serviceAreaSchema = z.object({
  en: z.string().trim().min(1).max(80),
  /**
   * Allowed to be empty so a half-finished list still saves. An area with no
   * Arabic name falls back to the English spelling, which is visibly
   * unfinished rather than a blank chip nobody can tap.
   */
  ar: z.string().trim().max(80),
});

/** The label to show a customer, with English as the fallback. */
export function areaLabel(area: ServiceArea, locale: string): string {
  if (locale === "ar") return area.ar.trim() || area.en;
  return area.en;
}

/**
 * Tolerates the pre-0012 shape.
 *
 * A cached `/api/settings` response, a stale edge node or a database that has
 * not been migrated yet can still hand back plain strings, and a booking form
 * that throws on them would be a blank page rather than a missing chip.
 */
export function toServiceAreas(value: unknown): ServiceArea[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      return name ? [{ en: name, ar: name }] : [];
    }
    const parsed = serviceAreaSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

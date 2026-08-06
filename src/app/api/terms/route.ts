import { getTerms } from "@/lib/booking/terms";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";

/**
 * GET /api/terms?locale=ar — the terms, as paragraphs.
 *
 * A route of its own rather than a field on /api/settings, and that is the
 * same decision §4h records for `termsAvailable`: settings is fetched by every
 * visitor the moment the booking form mounts, and terms can run to pages. The
 * boolean belongs there because the form needs it to decide whether a step
 * exists; the text belongs here because only somebody who reached that step
 * needs it.
 *
 * PLAIN TEXT, never HTML — see the header of lib/booking/terms.ts. What is
 * returned is an array of paragraph strings, and the client renders them as
 * text nodes, so a back-office user cannot put markup on a public page.
 *
 * Cached for five minutes at the edge. Terms change rarely, and a customer
 * seeing five-minute-old wording is not a hazard the way a stale price or a
 * stale availability grid would be — those are re-checked server-side at hold
 * time, and this is too: POST /api/bookings/hold calls hasTerms() itself and
 * refuses a booking whose `termsAccepted` is missing.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("locale");
  const locale: Locale = routing.locales.includes(requested as Locale)
    ? (requested as Locale)
    : routing.defaultLocale;

  try {
    const terms = await getTerms(locale);
    return Response.json(terms, {
      headers: {
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=600, max-age=0",
      },
    });
  } catch {
    /*
     * A database without migration 0014, or a brief outage.
     *
     * Empty paragraphs rather than a 500, because the step reads this to
     * decide what to show and a failed fetch would leave the customer looking
     * at a spinner with no way forward. An empty result renders the "we could
     * not load these" message, which at least names the situation — and the
     * hold route still enforces the agreement server-side, so nothing is
     * waved through by this being empty.
     */
    return Response.json(
      { paragraphs: [], isFallback: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

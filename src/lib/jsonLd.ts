import type { Locale } from "@/i18n/routing";
import { SITE_URL, localeUrl } from "./seo";

/**
 * Structured data for the marketing page.
 *
 * Built from the SAME translation catalogue the page renders, never from a
 * parallel copy. Structured data that describes a page differently from the
 * page itself is a manual-action risk, and a hand-maintained duplicate of the
 * FAQ copy would drift on the first wording change — the FAQ answers here are
 * the ones the accordion prints, read through the same `t()`.
 *
 * Everything is emitted as one `@graph` so the nodes can reference each other
 * by `@id` instead of repeating the business details three times.
 */

/** Matches the FAQ items rendered by `components/marketing/Faq.tsx`. */
export const FAQ_ITEMS = [
  "space",
  "water",
  "experience",
  "weather",
  "booking",
] as const;

/**
 * Areas served, as plain names.
 *
 * Deliberately a constant rather than a read of `settings.service_areas`: the
 * marketing page is statically generated, and reading the database here would
 * make it dynamic — trading a page that renders in one round trip for one that
 * waits on Postgres, in order to keep a list that changes once a year fresh.
 * Keep it in step with the seeded areas by hand.
 */
const AREAS_SERVED = ["Doha", "Lusail", "Al Wakrah", "Al Khor", "Al Rayyan"];

export type JsonLdInput = {
  locale: Locale;
  /** `t` bound to the "common" namespace. */
  brand: string;
  tagline: string;
  /** `t` bound to "hero". */
  heroTitle: string;
  heroSubtitle: string;
  /** `t` bound to "footer". */
  email: string;
  phone: string;
  /** FAQ question/answer pairs, already translated, in render order. */
  faq: ReadonlyArray<{ question: string; answer: string }>;
  /** Absolute URL of the social/OG image. */
  imageUrl: string;
};

export function buildJsonLd(input: JsonLdInput) {
  const home = localeUrl(input.locale, "");
  const businessId = `${SITE_URL}/#business`;
  const serviceId = `${SITE_URL}/#service`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        /**
         * LocalBusiness rather than Organization: this is a service with a
         * defined geographic catchment, and `areaServed` is the property that
         * actually does something for a "flowrider rental near me" query.
         *
         * No `address` node. Schema.org wants a PostalAddress on a
         * LocalBusiness, but the business has no customer-facing premises —
         * the whole product is that it comes to you — and inventing a street
         * address to satisfy a validator would be a lie in a machine-readable
         * format, which is the worst place to put one. `areaServed` carries the
         * geography instead.
         */
        "@type": "LocalBusiness",
        "@id": businessId,
        name: input.brand,
        description: input.tagline,
        url: home,
        image: input.imageUrl,
        email: input.email,
        // E.164, spaces stripped: the display form is for humans, this is not.
        telephone: input.phone.replace(/\s/g, ""),
        priceRange: "$$$$",
        areaServed: AREAS_SERVED.map((name) => ({
          "@type": "City",
          name,
          containedInPlace: { "@type": "Country", name: "Qatar" },
        })),
        // The reading language of THIS page, so the two locale variants are not
        // reported as one business described twice.
        inLanguage: input.locale,
      },
      {
        "@type": "Service",
        "@id": serviceId,
        name: input.heroTitle,
        description: input.heroSubtitle,
        serviceType: "Mobile flowrider rental",
        provider: { "@id": businessId },
        areaServed: { "@type": "Country", name: "Qatar" },
        // No `offers` node with a price. Pricing lives in `settings` and is
        // changed from the back office without a deploy, so a number baked in
        // here would go stale silently and be quoted back to us by a customer
        // who read it in a search result.
        url: `${home}#booking`,
        inLanguage: input.locale,
      },
      {
        "@type": "FAQPage",
        "@id": `${home}#faq`,
        inLanguage: input.locale,
        mainEntity: input.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: input.brand,
        inLanguage: input.locale,
        publisher: { "@id": businessId },
      },
    ],
  };
}

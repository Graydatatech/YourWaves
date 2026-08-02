import type { MetadataRoute } from "next";
import { SITE_URL, hasCanonicalOrigin } from "@/lib/seo";

/**
 * /robots.txt
 *
 * The disallow list is not about hiding things — robots.txt hides nothing, and
 * anything genuinely private here is behind auth or a capability token. It is
 * about crawl budget and about not putting URLs into an index where they would
 * be actively harmful:
 *
 *   /api/         no page, no value, and some routes cost a database round trip
 *   /admin        already noindex + gated; listing it keeps it out of a crawl
 *   /d/           the dispatch job sheet. The URL IS the credential. It is
 *                 already noindex/nofollow/no-referrer, but a crawler that
 *                 followed one from a leaked chat log and cached it would put a
 *                 customer's home address in a search result. Belt and braces.
 *   /dev/         404s in production, but only in production.
 *   /*/booking/   per-booking success/failure pages, keyed by reference. No
 *                 search value, and they name a real customer's order.
 *   /*/styleguide the design system reference.
 *
 * Nothing is disallowed that a customer needs to find.
 */
export default function robots(): MetadataRoute.Robots {
  /**
   * Without a configured origin the sitemap URL would point at localhost, which
   * is worse than omitting it — a crawler that fetches it once and fails is
   * slower to come back. `NEXT_PUBLIC_SITE_URL` is the one variable this
   * depends on.
   */
  const sitemap = hasCanonicalOrigin() ? `${SITE_URL}/sitemap.xml` : undefined;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/admin/",
          "/d/",
          "/dev/",
          "/*/booking/",
          "/*/styleguide",
        ],
      },
    ],
    sitemap,
    host: hasCanonicalOrigin() ? SITE_URL : undefined,
  };
}

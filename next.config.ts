import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // One fewer response header on every request, and one fewer free hint about
  // what this is running on.
  poweredByHeader: false,

  images: {
    // AVIF first, WebP fallback. Ordered by preference — Next serves the first
    // format the requesting browser accepts.
    formats: ["image/avif", "image/webp"],
    // Mobile-first breakpoints: 390/414 device widths at DPR 1-3 are what we
    // actually serve, so the small end is dense and the large end is sparse.
    deviceSizes: [390, 414, 640, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 64, 128, 256, 384],
    // Every image on this site is a static asset imported as a module, so its
    // URL is content-hashed and a new file is a new URL. There is no staleness
    // to protect against, and the default 60s means a returning visitor
    // re-validates imagery that cannot have changed. One year.
    minimumCacheTTL: 31_536_000,
    // Deliberately NOT set: `qualities` (nothing overrides the default 75, and
    // pinning it is a Next-16-specific key this phase could not verify against
    // the installed version), `remotePatterns` (empty is the default, and the
    // optimiser must never be pointed at a remote host — an open image proxy is
    // a bandwidth bill and an SSRF surface), and `dangerouslyAllowSVG` (an SVG
    // is a script; serving attacker-supplied markup from our own origin is the
    // whole reason that flag is named the way it is).
  },

  async headers() {
    return [
      {
        /**
         * The generated placeholder imagery (and, later, the real
         * photography). These are served straight from `public/` when
         * referenced by path, which gets no cache headers by default — so a
         * repeat visitor re-downloads them.
         *
         * The components import these as modules, so `next/image` already
         * emits content-hashed, immutably-cached URLs. This rule covers the
         * direct-path cases that remain: the OG image fallback, and anything
         * referenced from an email or a share card. A week, not a year,
         * because these paths are NOT content-hashed and the real photography
         * will replace the placeholders in place.
         */
        source: "/media/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // The dispatch job sheet is a capability URL. Nothing about it may be
        // cached by a shared proxy, and it must never appear in a search index
        // — the layout sets the meta tags, this sets the header that CDNs and
        // crawlers actually honour.
        source: "/d/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // Same for the back office: never indexed, never cached.
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

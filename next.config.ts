import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // AVIF first, WebP fallback. Ordered by preference — Next serves the first
    // format the requesting browser accepts.
    formats: ["image/avif", "image/webp"],
    // Mobile-first breakpoints: 390/414 device widths at DPR 1-3 are what we
    // actually serve, so the small end is dense and the large end is sparse.
    deviceSizes: [390, 414, 640, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 64, 128, 256, 384],
  },
};

export default withNextIntl(nextConfig);

/**
 * Generates the placeholder imagery for the marketing page.
 *
 * These stand in for the real photography/video stills. They are committed as
 * raster files (not SVG) so `next/image` can genuinely optimise them into
 * AVIF/WebP and so the layout is exercised with realistic byte weights.
 *
 * Run: node scripts/generate-placeholders.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "media");

/** Brand-consistent ocean palette. */
const SCENES = [
  {
    name: "hero-poster",
    w: 1920,
    h: 1080,
    from: "#0a2c46",
    via: "#0b8fa3",
    to: "#22e0d6",
    angle: 200,
  },
  {
    name: "gallery-1",
    w: 1200,
    h: 1600,
    from: "#04202f",
    via: "#0b8fa3",
    to: "#7ff2ea",
    angle: 160,
  },
  {
    name: "gallery-2",
    w: 1600,
    h: 1200,
    from: "#0a2c46",
    via: "#34c8ff",
    to: "#d3ecf6",
    angle: 30,
  },
  {
    name: "gallery-3",
    w: 1200,
    h: 1200,
    from: "#04141f",
    via: "#0b8fa3",
    to: "#22e0d6",
    angle: 300,
  },
  {
    name: "gallery-4",
    w: 1600,
    h: 1000,
    from: "#0c3654",
    via: "#22e0d6",
    to: "#e9f3f8",
    angle: 210,
  },
  {
    name: "gallery-5",
    w: 1200,
    h: 1500,
    from: "#04202f",
    via: "#34c8ff",
    to: "#7ff2ea",
    angle: 120,
  },
  {
    name: "gallery-6",
    w: 1400,
    h: 1050,
    from: "#0a2c46",
    via: "#0b8fa3",
    to: "#34c8ff",
    angle: 250,
  },
];

/**
 * Builds an SVG with a layered gradient plus soft elliptical highlights, which
 * reads as water/spray at thumbnail size without looking like a solid block.
 */
function scene({ w, h, from, via, to, angle }) {
  const rad = (angle * Math.PI) / 180;
  const x2 = (50 + 50 * Math.cos(rad)).toFixed(2);
  const y2 = (50 + 50 * Math.sin(rad)).toFixed(2);

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="${(100 - x2).toFixed(2)}%" y1="${(100 - y2).toFixed(2)}%" x2="${x2}%" y2="${y2}%">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="spray" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${Math.round(w / 45)}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <g filter="url(#soft)" opacity="0.75">
    <ellipse cx="${w * 0.72}" cy="${h * 0.28}" rx="${w * 0.3}" ry="${h * 0.22}" fill="url(#spray)"/>
    <ellipse cx="${w * 0.24}" cy="${h * 0.74}" rx="${w * 0.34}" ry="${h * 0.2}" fill="url(#spray)"/>
  </g>
  <g opacity="0.16" fill="none" stroke="#ffffff" stroke-width="${Math.max(2, w / 400)}">
    <path d="M0 ${h * 0.66} Q ${w * 0.25} ${h * 0.56}, ${w * 0.5} ${h * 0.66} T ${w} ${h * 0.62}"/>
    <path d="M0 ${h * 0.78} Q ${w * 0.3} ${h * 0.68}, ${w * 0.6} ${h * 0.78} T ${w} ${h * 0.74}"/>
  </g>
</svg>`);
}

await mkdir(OUT, { recursive: true });

for (const s of SCENES) {
  const file = join(OUT, `${s.name}.jpg`);
  await sharp(scene(s)).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
  console.log(`✓ ${s.name}.jpg  ${s.w}x${s.h}`);
}

console.log(`\nWrote ${SCENES.length} placeholders to public/media/`);

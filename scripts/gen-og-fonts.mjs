/**
 * Fetches the two font faces the OG card needs into `public/fonts/`.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `next/font/google` already downloads Sora and IBM Plex Sans Arabic at build
 * time, but it puts them in `.next/static/media/` under content-hashed names
 * that nothing outside the bundler can address. Satori — the renderer behind
 * `next/og` — needs an actual ArrayBuffer of an actual font file, and has no
 * system fonts to fall back on. So the OG route reads from a path we control,
 * and this script is what puts something there.
 *
 * It is NOT part of `pnpm build`. Run it once and commit the two files: a build
 * that reaches out to Google Fonts is a build that fails when Google Fonts is
 * slow, and a deploy is the worst moment to discover that. The OG route already
 * degrades to a text-free card if the files are missing, so forgetting to run
 * this is a duller share image, never a failed deploy.
 *
 * Usage:  node scripts/gen-og-fonts.mjs
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "fonts");

/**
 * Static TTFs from the google/fonts repository rather than the CSS API.
 *
 * fonts.googleapis.com serves woff2, which Satori cannot parse — it wants TTF
 * or OTF. These are the upstream sources those woff2 files are built from, so
 * the shapes match what the site renders.
 *
 * The variable-font files are used and the weight is selected at render time;
 * `Sora[wght].ttf` is a single file covering 100-800.
 */
const FONTS = [
  {
    file: "Sora-ExtraBold.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/sora/Sora%5Bwght%5D.ttf",
  },
  {
    file: "IBMPlexSansArabic-Bold.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf",
  },
];

await mkdir(OUT, { recursive: true });

let failures = 0;

for (const font of FONTS) {
  const target = join(OUT, font.file);

  try {
    const existing = await stat(target);
    if (existing.size > 0) {
      console.log(`  = ${font.file} (already present, ${existing.size} bytes)`);
      continue;
    }
  } catch {
    // Not there yet — fall through and fetch it.
  }

  try {
    const response = await fetch(font.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    // A redirect to an HTML error page is still a 200. TTF and OTF both start
    // with a recognisable magic number; anything else is not a font.
    const magic = bytes.subarray(0, 4).toString("hex");
    const looksLikeFont =
      magic === "00010000" || magic === "4f54544f" || magic === "74727565";
    if (!looksLikeFont) {
      throw new Error(`not a font file (magic ${magic})`);
    }
    await writeFile(target, bytes);
    console.log(`  ✓ ${font.file} (${bytes.length} bytes)`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${font.file}: ${error.message}`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} font(s) could not be fetched. The OG route falls back to a\n` +
      `text-free card, so this is not fatal — but the share image will have no\n` +
      `wordmark until it is fixed.`,
  );
  process.exit(1);
}

console.log(`\nFonts are in public/fonts/. Commit them.`);

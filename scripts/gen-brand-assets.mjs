/**
 * Derives every logo file the site serves from ONE source image,
 * `brand/logo-source.png` (transparent background, full colour).
 *
 *   public/brand/logo.png        trimmed full-colour mark — light surfaces
 *   public/brand/logo-light.png  same shape in white — dark surfaces (footer,
 *                                OG card). The navy figure is invisible on
 *                                #04202f, so a recolour is not optional there.
 *   src/app/icon.png             512px tile for <link rel="icon">
 *   src/app/apple-icon.png       180px tile; iOS paints transparency BLACK, so
 *                                the tile is opaque white
 *   src/app/favicon.ico          16/32/48 PNG-in-ICO, for clients that ask for
 *                                /favicon.ico without reading the <head>
 *
 * The tiles sit on white because a browser tab bar may be dark, and the navy
 * figure would disappear on it.
 *
 * Replace the source with a higher-resolution (or SVG-rasterised) file and
 * re-run; nothing else needs to change.
 *
 * Usage:  pnpm gen:brand
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "brand", "logo-source.png");

async function main() {
  await mkdir(join(ROOT, "public", "brand"), { recursive: true });

  // Trim the transparent margin so layout sizes describe the mark, not air.
  const trimmed = await sharp(SOURCE).trim({ threshold: 1 }).png().toBuffer();
  const { width, height } = await sharp(trimmed).metadata();
  await writeFile(join(ROOT, "public", "brand", "logo.png"), trimmed);

  // White silhouette: keep the alpha channel, flood the colour.
  const alpha = await sharp(trimmed).extractChannel("alpha").toBuffer();
  const light = await sharp({
    create: { width, height, channels: 3, background: "#ffffff" },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  await writeFile(join(ROOT, "public", "brand", "logo-light.png"), light);

  const tile = async (size, radiusRatio) => {
    const pad = Math.round(size * 0.1);
    const mark = await sharp(trimmed)
      .resize({ width: size - pad * 2, height: size - pad * 2, fit: "inside" })
      .toBuffer();
    const r = Math.round(size * radiusRatio);
    const bg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#ffffff"/></svg>`,
    );
    return sharp(bg).composite([{ input: mark, gravity: "center" }]).png().toBuffer();
  };

  await writeFile(join(ROOT, "src", "app", "icon.png"), await tile(512, 0.22));
  // Apple applies its own mask: a square, opaque tile.
  await writeFile(join(ROOT, "src", "app", "apple-icon.png"), await tile(180, 0));

  // ICO with embedded PNGs (supported by every browser since IE Vista-era).
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map((s) => tile(s, 0.18)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s, e);
    header.writeUInt8(s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  await writeFile(join(ROOT, "src", "app", "favicon.ico"), Buffer.concat([header, ...pngs]));

  console.log(`✓ logo ${width}x${height} → public/brand/, src/app/{icon,apple-icon}.png, favicon.ico`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

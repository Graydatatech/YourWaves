import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing, isLocale, type Locale } from "@/i18n/routing";

/**
 * The social card, generated per locale.
 *
 * This is the image WhatsApp shows when somebody forwards the link — which,
 * for a Qatari villa-booking product, is the single most common way a new
 * visitor first sees the brand. It is worth more than the Twitter card.
 *
 * Composed rather than photographed: the placeholder imagery in public/media is
 * generated gradient art, so cropping it to 1200x630 and stamping type on it
 * would look like a stock template. A typographic card on the brand gradient
 * reads as deliberate at thumbnail size, which is the only size that matters.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "YourWaves";

/** Pre-render both cards at build time rather than on first share. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Satori — what next/og renders with — has no system fonts. It cannot lay out
 * a single glyph without an embedded font file, and it will not fall back: a
 * missing font is a thrown error, and a thrown error in a metadata route at
 * build time is a failed deploy.
 *
 * The fonts are not in the repository (next/font downloads them into .next at
 * build, where their paths are not addressable). So this reads them from
 * `public/fonts/`, populated by `pnpm gen:og-fonts`, and returns null if they
 * are not there — see the fallback in the default export.
 */
async function loadFont(file: string): Promise<Buffer | null> {
  try {
    // Returned as a Buffer rather than converted to an ArrayBuffer: Satori
    // accepts either, and the conversion is the kind of thing that ends up
    // copying a 300KB font for no reason.
    return await readFile(join(process.cwd(), "public", "fonts", file));
  } catch {
    return null;
  }
}

/**
 * The card without any text, for when the fonts are absent.
 *
 * Not an error page and not a blank — it is the brand gradient with the logo
 * dot, which is a perfectly respectable share image. The point is that a
 * missing optional asset degrades the card instead of failing the build,
 * because a build that fails on a font nobody remembered to fetch is a worse
 * outcome than a card without a wordmark.
 *
 * It contains NO text nodes, deliberately. That is what makes it safe without
 * an embedded font: Satori only needs a font when it has glyphs to measure.
 * Do not add a wordmark here "since it is only one word" — that is the exact
 * change that would make the fallback throw the error it exists to avoid.
 */
function fontlessCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #04202f 0%, #0b8fa3 60%, #22e0d6 100%)",
        }}
      >
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 9999,
            background: "linear-gradient(135deg, #22e0d6, #34c8ff)",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : routing.defaultLocale;
  const isRtl = locale === "ar";

  // Opts this route into static rendering. Without it, next-intl reads
  // `requestLocale` from the request and the card is generated per request —
  // running Satori and a font parse on every share, for an image that is
  // identical every time.
  setRequestLocale(locale);

  // Latin for `en`, Arabic for `ar`. Only the one being rendered is loaded —
  // embedding both would put ~400KB through Satori for every card.
  const fontFile = isRtl
    ? "IBMPlexSansArabic-Bold.ttf"
    : "Sora-ExtraBold.ttf";
  const fontData = await loadFont(fontFile);
  if (!fontData) return fontlessCard();

  const tCommon = await getTranslations({ locale, namespace: "common" });
  const tHero = await getTranslations({ locale, namespace: "hero" });

  return new ImageResponse(
    (
      <div
        // `dir` is not a thing Satori understands, so RTL is expressed the only
        // way it can be here: the flex direction and text alignment are chosen
        // from the locale. That is also why the copy below is kept to whole
        // phrases with no inline numbers — there is no bidi algorithm in here
        // to isolate them with, so anything mixed-script would come out
        // scrambled. See the <Bidi> note in CLAUDE.md §4 for the DOM version of
        // this problem.
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "linear-gradient(135deg, #04202f 0%, #0a2c46 45%, #0b8fa3 100%)",
          color: "#ffffff",
          textAlign: isRtl ? "right" : "left",
        }}
      >
        {/* Wordmark row — the teal dot plus the brand, same as the header. */}
        <div
          style={{
            display: "flex",
            flexDirection: isRtl ? "row-reverse" : "row",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 9999,
              background: "linear-gradient(135deg, #22e0d6, #34c8ff)",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 34, letterSpacing: -0.5 }}>
            {tCommon("brand")}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: isRtl ? "flex-end" : "flex-start",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 900,
            }}
          >
            {tHero("title")}
          </div>
          {/* The teal underline is drawn, not typed: a rule reads at thumbnail
              size where a second line of copy does not. */}
          <div
            style={{
              width: 180,
              height: 10,
              borderRadius: 9999,
              background: "linear-gradient(135deg, #22e0d6, #34c8ff)",
              display: "flex",
            }}
          />
        </div>

        <div style={{ fontSize: 30, color: "#7ff2ea" }}>
          {tCommon("tagline")}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "og",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}

import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale, routing } from "@/i18n/routing";
import { getGallery, TILE_RATIOS } from "@/lib/site/gallery";
import gallery1 from "../../../public/media/gallery-1.jpg";
import gallery2 from "../../../public/media/gallery-2.jpg";
import gallery3 from "../../../public/media/gallery-3.jpg";
import gallery4 from "../../../public/media/gallery-4.jpg";
import gallery5 from "../../../public/media/gallery-5.jpg";
import gallery6 from "../../../public/media/gallery-6.jpg";
import { SectionIntro } from "./SectionIntro";
import { Testimonials } from "./Testimonials";

/**
 * Aspect ratios are declared per tile rather than measured, so every image
 * reserves its exact box before it loads. That is what keeps CLS at zero in a
 * masonry layout, where a late-loading image would otherwise reflow the column
 * beneath it.
 *
 * The ratio is still written by hand even though the static import now carries
 * the file's real dimensions: it is a DESIGN decision — the tile is cropped to
 * this shape — not a property of the source file, and the placeholder art will
 * be replaced by photography of different proportions.
 */
const TILES = [
  { src: gallery1, ratio: "3/4" },
  { src: gallery2, ratio: "4/3" },
  { src: gallery3, ratio: "1/1" },
  { src: gallery4, ratio: "8/5" },
  { src: gallery5, ratio: "4/5" },
  { src: gallery6, ratio: "4/3" },
] as const;

export async function Gallery() {
  const t = await getTranslations("gallery");

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : routing.defaultLocale;

  /**
   * Admin uploads if there are any, the committed placeholder art otherwise.
   * The fallback keeps its static imports, so an unconfigured site still gets
   * build-time blur placeholders and content-hashed URLs — an uploaded image
   * can have neither, which is the honest trade for being editable.
   */
  const tiles = await getGallery(
    locale,
    TILES.map((tile, index) => ({
      src: tile.src.src,
      alt: t("imageAlt", { number: index + 1 }),
      ratio: TILE_RATIOS[index] ?? tile.ratio,
      // The static import carries this; extracting `.src` alone would drop it
      // and `placeholder="blur"` would then throw for a missing blurDataURL.
      blurDataURL: tile.src.blurDataURL,
    })),
  );

  return (
    <section id="gallery" className="section-y">
      <div className="shell">
        <SectionIntro
          kicker={t("kicker")}
          title={t("title")}
          description={t("description")}
        />

        {/* CSS columns give masonry without JS. Column flow follows the
            document direction, so tiles fill right-to-left in Arabic. */}
        <div className="mt-12 [columns:260px] [column-gap:1rem]">
          {tiles.map((tile, index) => (
            <figure
              key={tile.src}
              className="rounded-card mb-4 break-inside-avoid overflow-hidden"
            >
              <div
                className="relative w-full"
                style={{ aspectRatio: tile.ratio }}
              >
                <Image
                  src={tile.src}
                  alt={tile.alt}
                  fill
                  loading="lazy"
                  sizes="(min-width: 1280px) 25vw, (min-width: 640px) 45vw, 92vw"
                  /**
                   * The blur is only available for the committed art, where a
                   * static import gives it at build time. An uploaded image is
                   * a URL — there is nothing to generate a placeholder from
                   * without decoding it on the server, which is a cost paid on
                   * every render for a below-the-fold tile.
                   */
                  placeholder={tile.blurDataURL ? "blur" : "empty"}
                  blurDataURL={tile.blurDataURL}
                  className="object-cover"
                />
              </div>
            </figure>
          ))}
        </div>
      </div>

      <Testimonials />
    </section>
  );
}

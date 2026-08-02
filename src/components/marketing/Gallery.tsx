import Image from "next/image";
import { useTranslations } from "next-intl";
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

export function Gallery() {
  const t = useTranslations("gallery");

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
          {TILES.map((tile, index) => (
            <figure
              key={tile.src.src}
              className="rounded-card mb-4 break-inside-avoid overflow-hidden"
            >
              <div
                className="relative w-full"
                style={{ aspectRatio: tile.ratio }}
              >
                <Image
                  src={tile.src}
                  alt={t("imageAlt", { number: index + 1 })}
                  fill
                  loading="lazy"
                  sizes="(min-width: 1280px) 25vw, (min-width: 640px) 45vw, 92vw"
                  // Six lazy tiles below the fold: the blur is what stops the
                  // gallery reading as six grey holes while they stream in on
                  // 4G. It costs no extra request — it is inlined base64.
                  placeholder="blur"
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

import Image from "next/image";
import { useTranslations } from "next-intl";
import { SectionIntro } from "./SectionIntro";
import { Testimonials } from "./Testimonials";

/**
 * Aspect ratios are declared per tile rather than measured, so every image
 * reserves its exact box before it loads. That is what keeps CLS at zero in a
 * masonry layout, where a late-loading image would otherwise reflow the column
 * beneath it.
 */
const TILES = [
  { src: "/media/gallery-1.jpg", ratio: "3/4" },
  { src: "/media/gallery-2.jpg", ratio: "4/3" },
  { src: "/media/gallery-3.jpg", ratio: "1/1" },
  { src: "/media/gallery-4.jpg", ratio: "8/5" },
  { src: "/media/gallery-5.jpg", ratio: "4/5" },
  { src: "/media/gallery-6.jpg", ratio: "4/3" },
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
              key={tile.src}
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

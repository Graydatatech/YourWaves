import Image from "next/image";
import { useTranslations } from "next-intl";
import { Bidi } from "@/components/ui";
// Imported as a MODULE, not referenced by path. That is what gets us the
// intrinsic dimensions, the content-hashed immutable URL, and — the reason it
// matters here — a build-time blurDataURL. `placeholder="blur"` with a string
// src is silently ignored unless you hand-write the base64 yourself.
// `public/` is outside the @/* alias root, so this one is relative by
// necessity rather than by preference.
import heroPoster from "../../../public/media/hero-poster.jpg";
import { HeroMedia } from "./HeroMedia";

const STATS = [
  { value: "stats.hoursValue", label: "stats.hoursLabel" },
  { value: "stats.speedValue", label: "stats.speedLabel" },
] as const;

/**
 * Column count, keyed off STATS so the two cannot drift.
 *
 * `grid-cols-3` used to be hardcoded, so dropping a stat would have left a
 * third of the row empty — the remaining two pinned left with a gap where the
 * third used to be, which reads as a rendering fault rather than a design. A
 * template literal is no use here: Tailwind scans for complete class names, so
 * `grid-cols-${n}` produces nothing at all.
 */
const STAT_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/**
 * Path to the looping hero clip. Empty until the real footage is supplied —
 * an empty value means the <video> is never mounted and no request is made.
 *
 * Drop the file at `public/media/hero.mp4` and set this to "/media/hero.mp4"
 * to switch it on; the connection-aware loading logic in HeroMedia handles
 * everything from there.
 */
const HERO_VIDEO_SRC = "";

/**
 * Full-bleed hero with bottom-anchored content.
 *
 * Overflow containment: the decorative orb is deliberately positioned partly
 * outside the section's box, so the *section* clips it (`overflow-hidden`).
 * That is targeted containment of a known-oversized decoration — not a
 * page-level `overflow-x: hidden` masking an unknown offender.
 */
export function Hero() {
  const t = useTranslations("hero");

  return (
    <section
      id="top"
      // `on-dark` switches the focus ring to --accent-light for everything
      // inside: the CTAs sit on a near-black scrim where the default
      // --accent-strong ring measures 3.42:1 and reads as a smudge.
      className="on-dark relative isolate flex min-h-[min(92vh,860px)] flex-col justify-end overflow-hidden"
    >
      {/* Media layer ---------------------------------------------------- */}
      <div className="absolute inset-0 -z-10">
        <Image
          src={heroPoster}
          alt={t("posterAlt")}
          fill
          // The single LCP candidate on the page: fetched at highest priority,
          // never lazy. Everything else on the page is lazy by default.
          priority
          fetchPriority="high"
          sizes="100vw"
          // The blur is ~1KB of base64 inlined into the HTML, so it paints in
          // the same frame as the document and the hero is never a bare dark
          // rectangle on a slow connection. Chrome's low-entropy heuristic
          // excludes it from LCP candidacy, so this cannot flatter the metric.
          placeholder="blur"
          className="object-cover"
        />
        {HERO_VIDEO_SRC && <HeroMedia src={HERO_VIDEO_SRC} />}
        {/* Scrim sits above both poster and video, below the copy. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[image:var(--hero-scrim)]"
        />
      </div>

      {/* Decorative orb -------------------------------------------------- */}
      <div
        aria-hidden="true"
        className={[
          "motion-decoration animate-floaty pointer-events-none absolute",
          "end-[-60px] -top-16 -z-10 size-[260px] rounded-full sm:size-[380px]",
          // The softness is baked into the gradient's colour stops rather than
          // applied with `blur-2xl`. A 40px filter on a 380px animated element
          // repaints a large surface every frame; the gradient costs nothing.
          "bg-[radial-gradient(circle,rgba(127,242,234,0.5)_0%,rgba(127,242,234,0.28)_38%,rgba(127,242,234,0.08)_62%,transparent_78%)]",
        ].join(" ")}
      />

      {/* Content --------------------------------------------------------- */}
      <div className="shell pt-[clamp(96px,18vw,180px)] pb-[clamp(40px,8vw,88px)]">
        <div className="max-w-3xl">
          <p
            className={[
              "rounded-pill inline-flex items-center border border-white/25",
              "bg-white/10 px-4 py-2 text-[13px] font-semibold text-white/90",
              "backdrop-blur-sm",
            ].join(" ")}
          >
            {t("badge")}
          </p>

          <h1 className="text-display mt-5 text-white">{t("title")}</h1>

          <p className="text-body mt-5 max-w-xl text-white/80">
            {t("subtitle")}
          </p>

          {/* CTAs: stacked and full-width on mobile, inline from 480px up. */}
          <div className="mt-8 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:flex-wrap">
            <a
              href="#booking"
              className={[
                "bg-brand text-ink-deep shadow-cta flex min-h-13 items-center justify-center",
                "rounded-pill px-7 text-base font-bold transition-[filter]",
                "hover:brightness-105 min-[480px]:inline-flex",
              ].join(" ")}
            >
              {t("primaryCta")}
            </a>
            <a
              href="#how-it-works"
              className={[
                "rounded-pill flex min-h-13 items-center justify-center",
                "border border-white/30 bg-white/10 px-7 text-base font-bold text-white",
                "backdrop-blur-md transition-colors hover:bg-white/20",
                "min-[480px]:inline-flex",
              ].join(" ")}
            >
              {t("secondaryCta")}
            </a>
          </div>

          {/* Stat row: a real 3-column grid, so the columns stay aligned
              instead of wrapping unevenly the way a flex row would. */}
          <dl
            className={[
              "mt-10 grid gap-x-3 gap-y-2 border-t border-white/15 pt-6",
              STAT_COLUMNS[STATS.length] ?? "grid-cols-2",
            ].join(" ")}
          >
            {STATS.map((stat) => (
              <div key={stat.value} className="min-w-0">
                <dt className="sr-only">{t(stat.label)}</dt>
                <dd>
                  <span className="font-display block text-[clamp(20px,5vw,32px)] font-extrabold text-white">
                    <Bidi>{t(stat.value)}</Bidi>
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-white/65">
                    {t(stat.label)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

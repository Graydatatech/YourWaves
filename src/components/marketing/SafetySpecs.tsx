import Image from "next/image";
import { useTranslations } from "next-intl";
import { Bidi } from "@/components/ui";
import specsImage from "../../../public/media/gallery-2.jpg";
import { SectionIntro } from "./SectionIntro";

const SPECS = [
  {
    label: "specs.footprintLabel",
    value: "specs.footprintValue",
    numeric: true,
  },
  { label: "specs.waterLabel", value: "specs.waterValue", numeric: true },
  { label: "specs.ridersLabel", value: "specs.ridersValue", numeric: false },
  { label: "specs.ageLabel", value: "specs.ageValue", numeric: false },
  { label: "specs.powerLabel", value: "specs.powerValue", numeric: false },
  { label: "specs.crewLabel", value: "specs.crewValue", numeric: false },
] as const;

export function SafetySpecs() {
  const t = useTranslations("safety");

  return (
    <section id="safety" className="section-y">
      <div className="shell">
        <SectionIntro
          kicker={t("kicker")}
          title={t("title")}
          description={t("description")}
        />

        {/* Image first in source order, which is also the mobile stacking
            order the design calls for. */}
        <div className="mt-12 grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div
            className={[
              "bg-dark-panel rounded-card relative isolate overflow-hidden",
              // 4/3 on mobile as specified; a taller minimum from lg up.
              "aspect-[4/3] lg:aspect-auto lg:min-h-[340px]",
            ].join(" ")}
          >
            <Image
              src={specsImage}
              alt={t("imageAlt")}
              fill
              loading="lazy"
              sizes="(min-width: 1024px) 45vw, 92vw"
              placeholder="blur"
              className="object-cover opacity-90 mix-blend-luminosity"
            />
            {/* Diagonal stripe overlay from the dark-panel token, kept visible
                over the photograph. */}
            <div
              aria-hidden="true"
              className="bg-dark-panel absolute inset-0 opacity-45"
            />
          </div>

          <dl className="border-border border-t">
            {SPECS.map((spec) => (
              <div
                key={spec.label}
                className={[
                  "border-border flex items-baseline justify-between gap-6",
                  "border-b py-4",
                ].join(" ")}
              >
                <dt className="text-muted text-base">{t(spec.label)}</dt>
                <dd className="text-ink text-end text-base font-bold">
                  {spec.numeric ? <Bidi>{t(spec.value)}</Bidi> : t(spec.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

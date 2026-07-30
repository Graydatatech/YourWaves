import { useTranslations } from "next-intl";
import { Accordion } from "@/components/ui";
import { SectionIntro } from "./SectionIntro";

const ITEMS = ["space", "water", "experience", "weather", "booking"] as const;

export function Faq() {
  const t = useTranslations("faq");

  return (
    <section id="faq" className="section-y">
      {/* Narrower measure than the page shell: long answers are easier to read
          at ~820px than at full width. */}
      <div className="section-x mx-auto w-full max-w-[820px]">
        <SectionIntro kicker={t("kicker")} title={t("title")} />

        <div className="mt-10 flex flex-col gap-3">
          {ITEMS.map((item) => (
            <Accordion
              key={item}
              id={`faq-${item}`}
              icon="plus"
              question={t(`items.${item}.question`)}
            >
              {t(`items.${item}.answer`)}
            </Accordion>
          ))}
        </div>
      </div>
    </section>
  );
}

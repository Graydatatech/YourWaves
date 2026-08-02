import { getLocale, getTranslations } from "next-intl/server";
import { Accordion } from "@/components/ui";
import { isLocale, routing } from "@/i18n/routing";
import { FAQ_ITEMS } from "@/lib/jsonLd";
import { getFaq } from "@/lib/site/faq";
import { SectionIntro } from "./SectionIntro";

/**
 * The FAQ, editable from the back office.
 *
 * Reads the settings row and falls back to the five designed questions in
 * `messages/*.json`, so an untouched deployment shows the designed set and an
 * admin who deletes every row gets it back rather than an empty section.
 *
 * The fallback list is `FAQ_ITEMS`, shared with the JSON-LD builder, and both
 * the accordion and the structured data go through `getFaq`. That is what stops
 * the two describing different questions — a mismatch that earns a manual
 * action rather than a ranking.
 */
export async function Faq() {
  const t = await getTranslations("faq");

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : routing.defaultLocale;

  const entries = await getFaq(
    locale,
    FAQ_ITEMS.map((item) => ({
      question: t(`items.${item}.question`),
      answer: t(`items.${item}.answer`),
    })),
  );

  return (
    <section id="faq" className="section-y">
      {/* Narrower measure than the page shell: long answers are easier to read
          at ~820px than at full width. */}
      <div className="section-x mx-auto w-full max-w-[820px]">
        <SectionIntro kicker={t("kicker")} title={t("title")} />

        <div className="mt-10 flex flex-col gap-3">
          {entries.map((entry, index) => (
            <Accordion
              // Index, not the question text: keying on content would remount
              // an item the moment an admin edited its wording, collapsing it
              // under a reader on the next revalidation.
              key={index}
              id={`faq-${index}`}
              icon="plus"
              question={entry.question}
            >
              {entry.answer}
            </Accordion>
          ))}
        </div>
      </div>
    </section>
  );
}

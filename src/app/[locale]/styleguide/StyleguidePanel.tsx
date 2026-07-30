import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { localeDirections } from "@/i18n/routing";
import {
  Accordion,
  Bidi,
  Button,
  Card,
  Input,
  Label,
  Pill,
  SectionHeading,
  Select,
  Skeleton,
} from "@/components/ui";
import { SheetDemo } from "./SheetDemo";
import arMessages from "../../../../messages/ar.json";
import enMessages from "../../../../messages/en.json";

const catalogues = { ar: arMessages, en: enMessages };

/** Sample data. Deliberately Latin/numeric to exercise <Bidi> in Arabic. */
const SAMPLE = {
  price: "QAR 3,500",
  phone: "+974 5512 3456",
  date: "14 Aug 2026",
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-muted-3 text-xs font-bold tracking-[0.14em] uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * Renders every primitive for one locale, inside a container carrying that
 * locale's `lang` and `dir`. Two of these side by side is the whole point of
 * the styleguide: mirroring bugs are obvious when both directions are visible
 * at once.
 */
export function StyleguidePanel({ locale }: { locale: Locale }) {
  const t = createTranslator({
    locale,
    messages: catalogues[locale],
    namespace: "styleguide",
  });

  return (
    <div
      lang={locale}
      dir={localeDirections[locale]}
      // font-sans re-declares font-family here so the nested locale picks up
      // its own --font-body rather than inheriting the document's.
      className="rounded-card border-border bg-surface/60 flex flex-col gap-8 border p-4 font-sans sm:p-6"
    >
      <SectionHeading
        kicker={`${t("kicker")} · ${localeDirections[locale]}`}
        title={t("title")}
        description={t("subtitle")}
      />

      <Row label={t("sections.buttons")}>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">{t("labels.primary")}</Button>
          <Button variant="secondary">{t("labels.secondary")}</Button>
          <Button variant="ghost">{t("labels.ghost")}</Button>
          <Button disabled>{t("labels.disabled")}</Button>
        </div>
        <Button size="lg" fullWidth>
          {t("labels.primary")}
        </Button>
      </Row>

      <Row label={t("sections.forms")}>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${locale}`} required>
            {t("labels.fullName")}
          </Label>
          <Input
            id={`name-${locale}`}
            placeholder={t("labels.fullNamePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`area-${locale}`}>{t("labels.area")}</Label>
          <Select id={`area-${locale}`} defaultValue="doha">
            <option value="doha">{t("areas.doha")}</option>
            <option value="alWakrah">{t("areas.alWakrah")}</option>
            <option value="lusail">{t("areas.lusail")}</option>
          </Select>
        </div>
      </Row>

      <Row label={t("sections.surfaces")}>
        <div className="flex flex-wrap gap-2">
          <Pill tone="brand">{t("labels.pillPopular")}</Pill>
          <Pill tone="neutral">{t("labels.pillNew")}</Pill>
          <Pill tone="outline">{SAMPLE.date}</Pill>
        </div>
        <Card>
          <h4 className="text-ink font-bold">{t("labels.cardTitle")}</h4>
          <p className="text-muted mt-2">{t("labels.cardBody")}</p>
          <p className="text-ink mt-3 text-lg font-bold">
            <Bidi>{SAMPLE.price}</Bidi>
          </p>
        </Card>
        <Card tone="dark">
          <p className="font-semibold">{t("labels.cardBody")}</p>
        </Card>
      </Row>

      <Row label={t("sections.accordion")}>
        <Accordion question={t("labels.faqQuestion")} defaultOpen>
          {t("labels.faqAnswer")}
        </Accordion>
        <Accordion question={t("labels.faqQuestion")}>
          {t("labels.faqAnswer")}
        </Accordion>
      </Row>

      <Row label={t("sections.sheet")}>
        <SheetDemo
          openLabel={t("labels.openSheet")}
          title={t("labels.sheetTitle")}
          body={t("labels.sheetBody")}
          closeLabel={t("labels.closeSheet")}
        />
      </Row>

      <Row label={t("sections.skeleton")}>
        <Skeleton className="h-32" />
        <Skeleton lines={3} />
      </Row>

      <Row label={t("sections.bidi")}>
        <Card>
          <p className="text-muted">{t("labels.bidiExplainer")}</p>
          <ul className="text-ink mt-3 flex flex-col gap-2">
            <li>
              <Bidi>{SAMPLE.price}</Bidi>
            </li>
            <li>
              <Bidi>{SAMPLE.phone}</Bidi>
            </li>
            <li>
              <Bidi>{SAMPLE.date}</Bidi>
            </li>
          </ul>
        </Card>
      </Row>
    </div>
  );
}

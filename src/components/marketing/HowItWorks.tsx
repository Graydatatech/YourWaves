import { useTranslations } from "next-intl";
import { SectionIntro } from "./SectionIntro";

const STEPS = [
  { key: "delivery", icon: "🚚" },
  { key: "session", icon: "🎛️" },
  { key: "ride", icon: "🏄" },
] as const;

export function HowItWorks() {
  const t = useTranslations("howItWorks");

  return (
    <section id="how-it-works" className="section-y">
      <div className="shell">
        <SectionIntro
          kicker={t("kicker")}
          title={t("title")}
          description={t("description")}
        />

        {/*
          auto-fit + minmax(260px, 1fr) collapses to a single column below
          ~560px on its own, so no breakpoint is needed for the mobile case.
        */}
        <ul className="mt-12 grid [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] gap-5">
          {STEPS.map((step, index) => (
            <li
              key={step.key}
              className={[
                "group border-border bg-surface shadow-card relative isolate",
                "rounded-card overflow-hidden border",
                // Reduced padding on mobile, as specified: 22px → 32px.
                "p-[22px] sm:p-8",
              ].join(" ")}
            >
              {/* Ghost number. Pinned to the inline end so it mirrors in
                  Arabic; aria-hidden because the ordered list already conveys
                  sequence to assistive technology. */}
              <span
                aria-hidden="true"
                className={[
                  "font-display text-ink/[0.05] pointer-events-none absolute",
                  "end-1 -top-4 -z-10 text-[110px] leading-none font-extrabold",
                  "select-none",
                ].join(" ")}
              >
                {index + 1}
              </span>

              <span
                aria-hidden="true"
                className="bg-accent/10 grid size-12 place-items-center rounded-2xl text-2xl"
              >
                {step.icon}
              </span>

              <p className="text-accent-strong mt-5 text-xs font-bold tracking-[0.16em] uppercase">
                {t(`steps.${step.key}.tag`)}
              </p>
              <h3 className="text-ink mt-2 text-xl font-bold">
                {t(`steps.${step.key}.title`)}
              </h3>
              <p className="text-muted mt-3 text-base leading-relaxed">
                {t(`steps.${step.key}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { useTranslations } from "next-intl";
import { Bidi } from "@/components/ui";
import { BrandMark } from "./BrandMark";

const SOCIALS = ["instagram", "whatsapp", "youtube"] as const;

export function SiteFooter() {
  const t = useTranslations("footer");
  const tCommon = useTranslations("common");
  // Server Component, so this is evaluated once at build time and baked into
  // the static HTML — no hydration mismatch is possible.
  const year = new Date().getFullYear();

  return (
    <footer className="bg-footer text-white/70">
      <div className="shell py-[clamp(40px,7vw,72px)]">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Brand ---------------------------------------------------- */}
          <div>
            <BrandMark label={tCommon("brand")} tone="light" />
            <p className="mt-4 max-w-xs text-base leading-relaxed">
              {t("tagline")}
            </p>
          </div>

          {/* Contact -------------------------------------------------- */}
          <div>
            <h2 className="text-xs font-bold tracking-[0.18em] text-white uppercase">
              {t("contactTitle")}
            </h2>
            <ul className="mt-4 flex flex-col gap-1">
              <li>
                <a
                  href={`mailto:${t("email")}`}
                  className="tap-target inline-flex items-center text-base hover:text-white"
                >
                  <Bidi>{t("email")}</Bidi>
                </a>
              </li>
              <li>
                <a
                  // tel: must carry the unspaced number.
                  href={`tel:${t("phone").replace(/\s/g, "")}`}
                  className="tap-target inline-flex items-center text-base hover:text-white"
                >
                  <Bidi>{t("phone")}</Bidi>
                </a>
              </li>
            </ul>

            <h2 className="mt-6 text-xs font-bold tracking-[0.18em] text-white uppercase">
              {t("citiesTitle")}
            </h2>
            <p className="mt-3 text-base">{t("cities")}</p>
          </div>

          {/* Social --------------------------------------------------- */}
          <div>
            <h2 className="text-xs font-bold tracking-[0.18em] text-white uppercase">
              {t("followTitle")}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SOCIALS.map((social) => (
                <li key={social}>
                  <a
                    href="#top"
                    className={[
                      "tap-target rounded-pill inline-flex items-center",
                      "border border-white/15 bg-white/5 px-5 text-sm font-semibold",
                      "text-white transition-colors hover:bg-white/15",
                    ].join(" ")}
                  >
                    {t(social)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Not Bidi-wrapped: the sentence itself must stay RTL in Arabic. A
            bare year is a weak-direction run and resolves correctly on its own;
            only compound runs like phone numbers need isolation. */}
        <p className="mt-12 border-t border-white/10 pt-6 text-sm">
          {t("rights", { year })}
        </p>
      </div>
    </footer>
  );
}

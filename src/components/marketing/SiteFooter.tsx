import { getLocale, getTranslations } from "next-intl/server";
import { Bidi } from "@/components/ui";
import { isLocale, routing } from "@/i18n/routing";
import { getFooter } from "@/lib/site/footer";
import { BrandMark } from "./BrandMark";

/**
 * The site footer, editable from the back office.
 *
 * ASYNC AND SERVER-RENDERED, reading the settings row. Anything an admin has
 * not set falls back to `messages/*.json`, so an untouched deployment renders
 * the designed copy and clearing a field in the settings screen restores the
 * default rather than blanking the line.
 *
 * `getTranslations` rather than `useTranslations`, because this component is
 * now async and the hook form is for synchronous rendering.
 *
 * The three social links used to be `href="#top"` placeholders — visible,
 * clickable and going nowhere. They render only when a URL exists now: a link
 * that does nothing is worse than an absent one.
 */
const SOCIALS = ["instagram", "whatsapp", "youtube"] as const;

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const tCommon = await getTranslations("common");

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : routing.defaultLocale;

  const footer = await getFooter(locale, {
    tagline: t("tagline"),
    email: t("email"),
    phone: t("phone"),
    cities: t("cities"),
  });

  // Evaluated per render — at build or revalidation for a statically generated
  // page, so no hydration mismatch is possible either way.
  const year = new Date().getFullYear();

  return (
    // `on-dark`: --accent-strong is 3.04:1 on the footer, which is inside
    // rounding distance of failing 2.4.11. --accent-light is 12.6:1.
    <footer className="bg-footer on-dark text-white/70">
      <div className="shell py-[clamp(40px,7vw,72px)]">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Brand ---------------------------------------------------- */}
          <div>
            <BrandMark label={tCommon("brand")} tone="light" />
            <p className="mt-4 max-w-xs text-base leading-relaxed">
              {footer.tagline}
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
                  href={`mailto:${footer.email}`}
                  className="tap-target inline-flex items-center text-base hover:text-white"
                >
                  <Bidi>{footer.email}</Bidi>
                </a>
              </li>
              <li>
                <a
                  // tel: must carry the unspaced number.
                  href={`tel:${footer.phone.replace(/\s/g, "")}`}
                  className="tap-target inline-flex items-center text-base hover:text-white"
                >
                  <Bidi>{footer.phone}</Bidi>
                </a>
              </li>
            </ul>

            <h2 className="mt-6 text-xs font-bold tracking-[0.18em] text-white uppercase">
              {t("citiesTitle")}
            </h2>
            <p className="mt-3 text-base">{footer.cities}</p>
          </div>

          {/* Social --------------------------------------------------- */}
          <div>
            <h2 className="text-xs font-bold tracking-[0.18em] text-white uppercase">
              {t("followTitle")}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SOCIALS.map((social) => {
                const href = footer[social];
                if (!href) return null;
                return (
                  <li key={social}>
                    <a
                      href={href}
                      target="_blank"
                      // `noopener` is the one that matters: without it the
                      // opened page gets a handle on this window.
                      rel="noopener noreferrer"
                      className={[
                        "tap-target rounded-pill inline-flex items-center",
                        "border border-white/15 bg-white/5 px-5 text-sm font-semibold",
                        "text-white transition-colors hover:bg-white/15",
                      ].join(" ")}
                    >
                      {t(social)}
                    </a>
                  </li>
                );
              })}
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

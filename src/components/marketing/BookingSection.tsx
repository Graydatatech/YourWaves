import { useTranslations } from "next-intl";
import { BookingFlow } from "@/components/booking";
import { SectionIntro } from "./SectionIntro";

/**
 * The booking section.
 *
 * Keeps `id="booking"` — the header links, hero CTA and mobile nav all resolve
 * here. The flow itself is a Client Component (it holds wizard state and talks
 * to the live availability API); this wrapper stays a Server Component so the
 * heading copy is rendered on the server and does not wait for hydration.
 *
 * `section-y` is dropped on narrow viewports: the mobile wizard manages its own
 * full-height layout and an extra 56px of section padding would push the pinned
 * footer controls off screen.
 */
export function BookingSection() {
  const t = useTranslations("booking");

  return (
    <section id="booking" className="wide:section-y py-10">
      <div className="shell">
        <SectionIntro
          kicker={t("kicker")}
          title={t("title")}
          description={t("description")}
          className="mb-8"
        />
        <BookingFlow />
      </div>
    </section>
  );
}

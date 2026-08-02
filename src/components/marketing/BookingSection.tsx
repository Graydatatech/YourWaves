import { useTranslations } from "next-intl";
// Imported from the module, NOT from @/components/booking. The barrel also
// exports BookingFlow itself, and pulling the wizard's entry point back into
// this server module's import graph is exactly what the lazy wrapper exists to
// avoid — a tree-shake away from undoing the split is too close for the one
// import that matters.
import { BookingFlowLazy } from "@/components/booking/BookingFlowLazy";
import { SectionIntro } from "./SectionIntro";

/**
 * The booking section.
 *
 * Keeps `id="booking"` — the header links, hero CTA and mobile nav all resolve
 * here. The flow itself is a Client Component (it holds wizard state and talks
 * to the live availability API); this wrapper stays a Server Component so the
 * heading copy is rendered on the server and does not wait for hydration.
 *
 * The flow is behind `BookingFlowLazy`, which holds its JavaScript back until
 * the section is within about a screen of the viewport (or the main thread goes
 * idle, whichever comes first). The heading, kicker and description above it
 * are unaffected — they are server-rendered HTML either way, so the section is
 * readable and the anchor is a real destination before any of the wizard has
 * been fetched.
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
        <BookingFlowLazy />
      </div>
    </section>
  );
}

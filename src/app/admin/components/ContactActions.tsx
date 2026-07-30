"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { buildAdminMapsLink } from "@/lib/admin/maps";

// Re-exported for call sites that want the link and the buttons together.
export { buildAdminMapsLink };

/**
 * Call / WhatsApp / Maps.
 *
 * These are the three things an ops person does with a booking on a phone, so
 * they are full-width tap targets rather than icons in a row — a 44px icon is
 * the minimum, not the target, when someone is standing next to a van.
 *
 * `tel:` and `wa.me` both hand off to a native app.
 *
 * `"use client"` is load-bearing here for the same reason as StatusPill — see
 * the note there. The link builder itself lives in @/lib/admin/maps so a Server
 * Component can use it without importing a client module.
 */
const ACTION = cn(
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-pill border",
  "border-border bg-surface px-3 text-sm font-semibold text-ink",
  "hover:border-accent/50 transition-colors",
);

export function ContactActions({
  phone,
  mapsHref,
  className,
}: {
  phone: string;
  mapsHref: string;
  className?: string;
}) {
  const t = useTranslations("admin");
  const digits = phone.replace(/\D/g, "");

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <a href={`tel:${phone.replace(/\s/g, "")}`} className={ACTION}>
        {t("booking.call")}
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        className={ACTION}
      >
        {t("booking.whatsapp")}
      </a>
      <a
        href={mapsHref}
        target="_blank"
        rel="noopener noreferrer"
        className={ACTION}
      >
        {t("booking.maps")}
      </a>
    </div>
  );
}

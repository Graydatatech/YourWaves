"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useBooking } from "./BookingProvider";

/**
 * The last screen before payment: the three things the site must have.
 *
 * In `--danger` on purpose, at the same type sizes as every other step. A
 * ride that cannot fit through the gate is a wasted delivery day for the crew
 * and a cancelled party for the customer, and this is the one moment it can
 * still be caught for free.
 *
 * The confirmation is a toggle BUTTON rather than a checkbox because the
 * business asked for a button, but it behaves like one: `aria-pressed` tells a
 * screen reader the state, and pressing it again takes the confirmation back.
 * It only records the answer; the pay button below is still what moves money.
 */
export function SiteCheckStep() {
  const t = useTranslations("booking.site");
  const { draft, patch } = useBooking();
  const confirmed = draft.siteConfirmed === true;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-danger flex flex-col gap-3">
        <h3 className="text-xl font-bold">{t("title")}</h3>
        <p className="text-base leading-relaxed">{t("intro")}</p>
        <ul className="flex list-disc flex-col gap-2 ps-6 text-base leading-relaxed">
          <li>{t("gateWidth")}</li>
          <li>{t("gateHeight")}</li>
          <li>{t("space")}</li>
        </ul>
      </div>

      <button
        type="button"
        aria-pressed={confirmed}
        onClick={() => patch({ siteConfirmed: !confirmed })}
        className={cn(
          "rounded-pill flex min-h-14 w-full items-center justify-center gap-2 border-2 px-5 py-3",
          "text-center text-base leading-snug font-bold transition-colors",
          confirmed
            ? "border-accent-strong bg-accent-strong text-white"
            : "border-danger bg-surface text-danger hover:bg-danger-surface",
        )}
      >
        {confirmed && <span aria-hidden="true">✓</span>}
        {t("confirm")}
      </button>
    </div>
  );
}

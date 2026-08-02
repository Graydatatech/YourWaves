"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { BookingStatus } from "@/lib/admin/types";

/**
 * The status chip, used on every screen.
 *
 * `"use client"` IS LOAD-BEARING. Without it this renders as a Server
 * Component, where `useTranslations` resolves through src/i18n/request.ts —
 * which knows nothing about /admin, falls back to the `ar` default, and throws
 * MISSING_MESSAGE because the `admin` namespace is English-only. The admin
 * layout's NextIntlClientProvider only reaches CLIENT components.
 *
 * Colour is a hint, never the message: each pill also carries its label, so it
 * survives a colourblind reader and a greyscale print of the day's runsheet.
 * The palette is flatter than the marketing site's — this is a dense
 * information screen, and a gradient on forty chips is noise.
 */
/**
 * Every pair here is a text colour on its own tint, so each one is its own
 * contrast question — a pill palette is exactly where a 4.3:1 hides, because
 * nothing else on the screen uses that combination.
 *
 * `pnpm check:contrast` PARSES THIS MAP and holds every pair to 4.5:1, so the
 * literal `bg-[#…] text-[#…]` shape is load-bearing: keep the two in that order
 * in the same string, or the check silently stops covering the row.
 *
 * Phase 10 fixed two: `expired` was #64748b on #f1f5f9 (4.34:1, a real AA
 * failure), and `confirmed` was still on the pre-phase-10 accent #0a7a8c, which
 * scraped 4.55:1.
 */
const TONE: Record<BookingStatus, string> = {
  holding: "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]",
  pending: "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]",
  confirmed: "bg-[#e8f6fb] text-[#097182] border-[#b8e3ef]",
  assigned: "bg-[#eef2ff] text-[#3730a3] border-[#c7d2fe]",
  en_route: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]",
  completed: "bg-[#f1f5f9] text-[#334155] border-[#cbd5e1]",
  cancelled: "bg-[#fdeceb] text-[#b3261e] border-[#f5c2be]",
  expired: "bg-[#f1f5f9] text-[#5f6e84] border-[#cbd5e1]",
};

export function StatusPill({
  status,
  size = "sm",
}: {
  status: BookingStatus;
  size?: "sm" | "md";
}) {
  const t = useTranslations("admin");

  return (
    <span
      className={cn(
        "rounded-pill inline-flex items-center border font-semibold whitespace-nowrap",
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        TONE[status],
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

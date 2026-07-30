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
const TONE: Record<BookingStatus, string> = {
  holding: "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]",
  pending: "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]",
  confirmed: "bg-[#e8f6fb] text-[#0a7a8c] border-[#b8e3ef]",
  assigned: "bg-[#eef2ff] text-[#3730a3] border-[#c7d2fe]",
  en_route: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]",
  completed: "bg-[#f1f5f9] text-[#334155] border-[#cbd5e1]",
  cancelled: "bg-[#fdeceb] text-[#b3261e] border-[#f5c2be]",
  expired: "bg-[#f1f5f9] text-[#64748b] border-[#cbd5e1]",
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

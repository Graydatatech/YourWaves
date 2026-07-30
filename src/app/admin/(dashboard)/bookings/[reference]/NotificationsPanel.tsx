"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NotificationLogEntry } from "@/lib/notifications/queries";
import { cn } from "@/lib/cn";

/**
 * The phase-7 outbox for this booking, with the resend button the brief asks
 * for.
 *
 * `failed` is the row that matters: it means the customer did NOT get that
 * message. It is coloured accordingly and carries the provider's own error, so
 * whoever is looking can tell "bad phone number" from "Meta was down".
 */
const TONE: Record<string, string> = {
  sent: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]",
  queued: "bg-[#fff7ed] text-[#92400e] border-[#fcd9a4]",
  failed: "bg-[#fdeceb] text-[#b3261e] border-[#f5c2be]",
};

export function NotificationsPanel({
  entries,
}: {
  entries: NotificationLogEntry[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function resend(id: string) {
    setBusy(id);
    await fetch(`/api/admin/notifications/${id}/resend`, { method: "POST" });
    setBusy(null);
    setDone(id);
    router.refresh();
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <h2 className="text-ink-deep text-sm font-bold">
        {t("booking.notifications")}
      </h2>

      {entries.length === 0 ? (
        <p className="text-muted-2 pt-2 text-sm">{t("common.none")}</p>
      ) : (
        <ul className="divide-border mt-2 divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-semibold">
                    {entry.templateKey}
                  </p>
                  <p className="text-muted-2 truncate text-xs">
                    {entry.channel} · {entry.recipient}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-pill shrink-0 border px-2 py-0.5 text-xs font-semibold",
                    TONE[entry.status] ?? TONE.queued,
                  )}
                >
                  {entry.status}
                  {entry.attempts > 1 ? ` ×${entry.attempts}` : ""}
                </span>
              </div>

              {entry.lastError ? (
                <p className="text-xs break-words text-[#b3261e]">
                  {entry.lastError}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => resend(entry.id)}
                  disabled={busy === entry.id}
                  className="text-accent-strong text-xs font-bold disabled:opacity-50"
                >
                  {busy === entry.id ? t("common.saving") : t("booking.resend")}
                </button>
                {done === entry.id ? (
                  <span className="text-xs text-[#065f46]">
                    {t("booking.resent")}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

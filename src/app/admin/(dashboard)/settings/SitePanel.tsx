"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { ConfirmSheet } from "../../components/ConfirmSheet";

/**
 * Website visibility: the pre-launch gate's on/off switch (migration 0023).
 *
 * Three states, because the switch only means something while SITE_PASSWORD
 * is set in the environment:
 *   no password configured → public, no button (there is nothing to switch)
 *   password, not opened   → "Open the website"
 *   password, opened       → "Lock it again"
 *
 * Both directions go through a ConfirmSheet. Opening puts a site that takes
 * payments in front of everyone and lets search engines in; locking sends
 * anybody midway through a booking to the password page. Neither should be one
 * mis-tap away. Saved through the same PATCH as every other setting, so the
 * change lands in the settings audit with a name against it.
 */
export function SitePanel({
  passwordConfigured,
  open,
}: {
  passwordConfigured: boolean;
  open: boolean;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublic = !passwordConfigured || open;

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteOpen: !open }),
      });
      if (!response.ok) {
        setError(t("site.saveFailed"));
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError(t("site.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ink-deep text-sm font-bold">{t("site.title")}</h2>
        <span
          className={cn(
            "rounded-pill border px-2.5 py-1 text-xs font-bold",
            isPublic
              ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
              : "border-[#fcd9a4] bg-[#fff7ed] text-[#92400e]",
          )}
        >
          {isPublic ? t("site.statusPublic") : t("site.statusLocked")}
        </span>
      </div>

      <p className="text-muted-2 pt-1 text-sm">
        {!passwordConfigured
          ? t("site.noPassword")
          : open
            ? t("site.openBody")
            : t("site.lockedBody")}
      </p>

      {passwordConfigured && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
              className={cn(
                "rounded-pill min-h-11 px-4 text-sm font-bold",
                open
                  ? "border-border text-ink border bg-white"
                  : "bg-[#097182] text-white",
              )}
            >
              {open ? t("site.lockAction") : t("site.openAction")}
            </button>
          </div>
          <p className="text-muted-2 pt-2 text-xs">{t("site.delayHint")}</p>
        </>
      )}

      {error && !confirming && (
        <p role="alert" className="text-danger pt-2 text-sm font-semibold">
          {error}
        </p>
      )}

      <ConfirmSheet
        open={confirming}
        title={open ? t("site.lockConfirmTitle") : t("site.openConfirmTitle")}
        body={open ? t("site.lockConfirmBody") : t("site.openConfirmBody")}
        confirmLabel={open ? t("site.lockAction") : t("site.openAction")}
        tone={open ? "danger" : "default"}
        pending={pending}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      >
        {error && (
          <p role="alert" className="text-danger text-sm font-semibold">
            {error}
          </p>
        )}
      </ConfirmSheet>
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatFullDate } from "@/lib/booking/format";
import { compareIsoDate, isIsoDate } from "@/lib/dates";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { cn } from "@/lib/cn";

/**
 * "Block days" — close one day or a run of days from any screen width.
 *
 * This exists because the phone shape of the calendar is an agenda that lists
 * only days which already HAVE something, so an empty day had no row to tap
 * and could not be closed from a phone at all. Native date inputs give the
 * platform picker for free and need no client calendar code.
 *
 * Days carrying a live booking are skipped by the server (the rule lives in
 * `add_blackout_date()`), and reported back here so nobody assumes the whole
 * range closed.
 */
export function BlockDaysSheet({
  today,
  onResult,
}: {
  today: string;
  onResult: (message: string) => void;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
    setReason("");
  }

  async function submit() {
    if (!isIsoDate(from) || !isIsoDate(to) || compareIsoDate(from, to) > 0) {
      setError(t("calendar.blockRangeInvalid"));
      return;
    }

    setPending(true);
    setError(null);

    const response = await fetch("/api/admin/blackouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to, reason }),
    });
    const detail = (await response.json().catch(() => ({}))) as {
      error?: string;
      blocked?: string[];
      skipped?: string[];
    };

    setPending(false);

    if (!response.ok) {
      setError(
        detail.error === "date_has_booking"
          ? t("calendar.blockRangeAllBooked")
          : detail.error === "invalid_range"
            ? t("calendar.blockRangeInvalid")
            : t("common.error"),
      );
      return;
    }

    const skipped = detail.skipped ?? [];
    let message = t("calendar.blockRangeDone", {
      count: detail.blocked?.length ?? 0,
    });
    if (skipped.length > 0) {
      message += ` ${t("calendar.blockRangeSkipped", {
        count: skipped.length,
        dates: skipped.map((date) => formatFullDate(date, "en")).join(", "),
      })}`;
    }

    close();
    onResult(message);
    router.refresh();
  }

  const inputClass = cn(
    "border-border bg-surface rounded-input min-h-12 w-full border px-3.5",
    // 16px minimum: a smaller input makes iOS Safari zoom on focus.
    "focus:border-accent text-base outline-none",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFrom(today);
          setTo(today);
          setOpen(true);
        }}
        className={cn(
          "border-border bg-surface text-ink rounded-pill tap-target border px-4 text-sm font-bold",
          "wide:w-auto w-full",
        )}
      >
        {t("calendar.blockDays")}
      </button>

      <ConfirmSheet
        open={open}
        pending={pending}
        tone="danger"
        title={t("calendar.blockDays")}
        body={error ?? t("calendar.blockRangeHint")}
        confirmLabel={t("calendar.blockRangeConfirm")}
        onConfirm={submit}
        onCancel={close}
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="block-from"
                className="text-ink text-sm font-semibold"
              >
                {t("calendar.blockFrom")}
              </label>
              <input
                id="block-from"
                type="date"
                value={from}
                min={today}
                onChange={(event) => {
                  const next = event.target.value;
                  setFrom(next);
                  // Keep the range valid as the start moves past the end.
                  if (isIsoDate(next) && compareIsoDate(next, to) > 0) {
                    setTo(next);
                  }
                }}
                className={inputClass}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="block-to"
                className="text-ink text-sm font-semibold"
              >
                {t("calendar.blockTo")}
              </label>
              <input
                id="block-to"
                type="date"
                value={to}
                min={from || today}
                onChange={(event) => setTo(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="block-reason"
              className="text-ink text-sm font-semibold"
            >
              {t("calendar.blackoutReason")}
            </label>
            <input
              id="block-reason"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("calendar.blackoutReasonPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
      </ConfirmSheet>
    </>
  );
}

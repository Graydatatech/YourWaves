"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ReviewRow } from "@/lib/admin/types";
import { ConfirmSheet } from "../../components/ConfirmSheet";

/**
 * The moderation queue.
 *
 * Card-shaped rather than a table, for the reason §4h gives about the orders
 * screen: seven columns on a phone leaves unreadable type or a horizontal
 * scroll nobody discovers. A review is mostly one long field anyway, which a
 * table column cannot hold.
 *
 * Published rows stay in the list rather than moving to a second tab. The
 * question an admin has is "what is on the site right now", and an interface
 * that hides the answer behind a filter makes them guess.
 */
export function ReviewsView({ reviews }: { reviews: ReviewRow[] }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReviewRow | null>(null);

  async function setPublished(row: ReviewRow, isPublished: boolean) {
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished }),
      });
      if (!response.ok) {
        setError(t("reviews.failed"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("reviews.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: ReviewRow) {
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reviews/${row.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(t("reviews.failed"));
        return;
      }
      router.refresh();
    } catch {
      setError(t("reviews.failed"));
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) {
    return (
      <p className="border-border bg-surface rounded-card text-muted-2 border p-4 text-sm">
        {t("reviews.empty")}
      </p>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="text-danger text-sm font-semibold">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {reviews.map((row) => (
          <li
            key={row.id}
            className="border-border bg-surface rounded-card border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {/* The rating as a labelled image: five glyphs read out one by
                    one is noise, and the number is the information. */}
                <span
                  role="img"
                  aria-label={t("reviews.ratingLabel", {
                    rating: row.rating ?? 0,
                  })}
                  dir="ltr"
                  className="text-accent text-sm"
                >
                  {"★".repeat(row.rating ?? 0)}
                  <span className="text-ink/20">
                    {"★".repeat(5 - (row.rating ?? 0))}
                  </span>
                </span>
                <span dir="ltr" className="text-muted-2 font-mono text-xs">
                  {row.reference}
                </span>
              </div>

              <span
                className={cn(
                  "rounded-pill border px-2 py-0.5 text-xs font-bold",
                  row.isPublished
                    ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
                    : "border-[#cbd5e1] bg-[#f1f5f9] text-[#5f6e84]",
                )}
              >
                {row.isPublished
                  ? t("reviews.published")
                  : t("reviews.unpublished")}
              </span>
            </div>

            {row.comment ? (
              <p className="text-ink mt-3 text-base whitespace-pre-line">
                {row.comment}
              </p>
            ) : (
              <p className="text-muted-3 mt-3 text-sm italic">
                {t("reviews.noComment")}
              </p>
            )}

            <p className="text-muted-2 mt-2 text-xs">
              {[row.authorName, row.authorArea].filter(Boolean).join(" · ")}
              {row.submittedAt
                ? ` — ${new Date(row.submittedAt).toLocaleString("en-GB", {
                    timeZone: "Asia/Qatar",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`
                : ""}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy === row.id || !row.comment}
                onClick={() => setPublished(row, !row.isPublished)}
                className={cn(
                  "rounded-pill min-h-11 px-4 text-sm font-bold",
                  row.isPublished
                    ? "border-border text-ink border"
                    : "bg-[#097182] text-white",
                  "disabled:opacity-45",
                )}
              >
                {row.isPublished
                  ? t("reviews.unpublish")
                  : t("reviews.publish")}
              </button>

              <button
                type="button"
                disabled={busy === row.id}
                onClick={() => setPendingDelete(row)}
                className="text-danger min-h-11 text-sm font-bold underline disabled:opacity-45"
              >
                {t("reviews.delete")}
              </button>

              {/* A rating with no words cannot be published — there is nothing
                  to quote. Said here rather than left as a disabled button
                  nobody can explain. */}
              {!row.comment && (
                <span className="text-muted-2 text-xs">
                  {t("reviews.needsComment")}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmSheet
        open={pendingDelete !== null}
        tone="danger"
        title={t("reviews.deleteTitle")}
        body={t("reviews.deleteBody")}
        confirmLabel={t("reviews.delete")}
        pending={busy !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const row = pendingDelete;
          setPendingDelete(null);
          if (row) void remove(row);
        }}
      />
    </>
  );
}

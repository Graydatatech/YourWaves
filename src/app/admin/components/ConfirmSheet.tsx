"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/**
 * The confirmation step for anything that notifies a customer.
 *
 * A bottom sheet rather than `confirm()`, for three reasons the brief is right
 * about: a browser dialog appears at the TOP of the screen on iOS (nowhere near
 * the thumb that triggered it), it cannot say what the consequence is beyond
 * one line of unstyled text, and it blocks the main thread.
 *
 * Built on <dialog>, so focus trapping, Escape, inert background and the top
 * layer come from the platform instead of 200 lines of focus management. The
 * same choice as the customer-facing Sheet primitive from phase 0.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  tone = "default",
  pending = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra fields the decision needs — a blackout reason, for instance. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("admin");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Escape and the backdrop both cancel. A destructive action must never be
      // easier to confirm than to abandon.
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !pending) onCancel();
      }}
      className={cn(
        "bg-transparent p-0 backdrop:bg-black/40",
        // Pinned to the bottom on a phone, centred once there is room.
        "m-0 w-full max-w-none self-end",
        "wide:m-auto wide:max-w-md wide:self-center",
      )}
    >
      <div
        className={cn(
          "bg-surface w-full p-5",
          "wide:rounded-3xl rounded-t-3xl",
          "wide:pb-5 pb-[calc(20px+env(safe-area-inset-bottom))]",
        )}
      >
        <div
          aria-hidden="true"
          className="bg-border wide:hidden mx-auto mb-4 h-1 w-10 rounded-full"
        />

        <h2 className="text-ink-deep text-lg font-extrabold">{title}</h2>
        <p className="text-muted pt-2 text-sm leading-relaxed">{body}</p>

        {children ? <div className="pt-4">{children}</div> : null}

        <div className="flex flex-col gap-2 pt-5">
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "rounded-pill min-h-12 px-6 text-base font-bold text-white",
              "disabled:opacity-60",
              tone === "danger" ? "bg-[#b3261e]" : "bg-accent",
            )}
          >
            {pending ? t("common.saving") : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={cn(
              "border-border text-ink rounded-pill min-h-12 border px-6",
              "text-base font-semibold disabled:opacity-60",
            )}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

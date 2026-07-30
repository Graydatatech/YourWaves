"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SheetVariant = "bottom" | "full";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * `bottom` — booking summaries and confirmations (default).
   * `full` — full-height navigation panel, anchored to the inline end.
   */
  variant?: SheetVariant;
  /** Accessible name when `title` is not a plain string. */
  label?: string;
};

/**
 * Built on <dialog>, which gives us the top layer, focus trapping, an inert
 * background and Escape-to-close from the platform rather than from a JS
 * focus-trap library.
 *
 * Both variants are positioned with logical properties only, so the full-height
 * panel slides in from the right in English and the left in Arabic with no
 * direction-specific rules.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  variant = "bottom",
  label,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      // Keep the page behind from scrolling under the sheet on iOS.
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = "";
    }
  }, [open]);

  // Separate effect so the scroll lock is released on unmount regardless of
  // which state the dialog was in.
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const isFull = variant === "full";

  return (
    <dialog
      ref={ref}
      // Fires on Escape and on dialog.close(); keeps React state in sync.
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) dismisses.
        if (event.target === ref.current) onClose();
      }}
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cn(
        "max-w-none bg-transparent p-0",
        "backdrop:bg-ink-deep/50 backdrop:backdrop-blur-xs",
        isFull
          ? // Full-height panel pinned to the inline end.
            "open:animate-slide-in-end m-0 ms-auto h-dvh max-h-dvh w-[min(88vw,380px)]"
          : "open:animate-rise-in mt-auto mb-0 max-h-[85dvh] w-full sm:m-auto sm:max-w-md",
      )}
    >
      {isFull ? (
        <div
          className={cn(
            "bg-surface flex h-full flex-col overflow-y-auto",
            "pt-[max(1rem,env(safe-area-inset-top))]",
            "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
            className,
          )}
        >
          {children}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-t-card bg-surface shadow-card sm:rounded-card",
            // Respect the iOS home indicator.
            "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
            className,
          )}
        >
          {/* Grab handle: a visual affordance only. */}
          <div className="flex justify-center pt-3 pb-1">
            <span
              className="rounded-pill bg-ink/15 h-1 w-10"
              aria-hidden="true"
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3">
            {title && (
              <h2 className="text-ink text-start text-lg font-bold">{title}</h2>
            )}
            <button
              type="button"
              onClick={onClose}
              className="tap-target rounded-pill text-muted hover:bg-ink/5 -me-2 grid place-items-center"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
                <path
                  d="M3 3l10 10M13 3L3 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="sr-only">Close</span>
            </button>
          </div>

          <div className="text-muted px-5 pt-1 text-base leading-relaxed">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}

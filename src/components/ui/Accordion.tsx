import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AccordionProps = {
  question: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /**
   * `chevron` — compact disclosure (default).
   * `plus` — FAQ styling: larger target, plus icon rotating to a cross.
   */
  icon?: "chevron" | "plus";
  /** Required for `aria-controls` wiring. */
  id?: string;
};

/**
 * Built on native <details>/<summary>, so it needs zero client JavaScript and
 * works before hydration — meaningful on a 4G connection.
 *
 * Accessibility: <summary> is natively a disclosure control. Browsers expose
 * its expanded state to assistive technology automatically and keep it in sync
 * with the `open` attribute. We deliberately do NOT hand-write `aria-expanded`
 * here — with no client JS to update it, a static value would go stale the
 * moment the user opens the item, which is worse than the native state. We do
 * set `aria-controls` to associate the panel.
 *
 * The open/close animation uses the grid 0fr→1fr technique, which animates to
 * intrinsic height without a hardcoded max-height and without JS measurement.
 */
export function Accordion({
  question,
  children,
  defaultOpen = false,
  className,
  icon = "chevron",
  id,
}: AccordionProps) {
  const panelId = id ? `${id}-panel` : undefined;
  const isPlus = icon === "plus";

  return (
    <details
      open={defaultOpen}
      className={cn(
        "group rounded-card border-border bg-surface shadow-card border",
        "open:border-accent/25",
        className,
      )}
    >
      <summary
        aria-controls={panelId}
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-4",
          "text-ink text-start font-semibold",
          "rounded-card focus-visible:outline-focus focus-visible:outline-2",
          "[&::-webkit-details-marker]:hidden",
          isPlus
            ? "min-h-16 px-5 py-4 text-[17px] sm:px-6"
            : "min-h-14 px-5 py-4",
        )}
      >
        <span className="min-w-0">{question}</span>

        {isPlus ? (
          <span
            aria-hidden="true"
            className={cn(
              "text-accent bg-accent/10 grid size-9 shrink-0 place-items-center rounded-full",
              "transition-transform duration-300 group-open:rotate-45",
            )}
          >
            <svg viewBox="0 0 14 14" className="size-3.5">
              <path
                d="M7 1v12M1 7h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="text-accent size-3 shrink-0 transition-transform duration-200 group-open:rotate-180"
          >
            <path
              d="M1 3.5 6 8.5l5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </summary>

      {/* grid-rows 0fr → 1fr animates to the content's intrinsic height. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          "grid-rows-[0fr] group-open:grid-rows-[1fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            id={panelId}
            className={cn(
              "text-muted text-body",
              isPlus ? "px-5 pb-5 sm:px-6" : "px-5 pb-5",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </details>
  );
}

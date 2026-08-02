import type { SelectHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  invalid?: boolean;
};

/**
 * Native <select> on purpose: it gets the platform picker on iOS and Android,
 * which is faster on 4G and already localised and RTL-aware.
 *
 * The chevron is drawn with a CSS mask positioned with `inset-inline-end`, so
 * it moves to the left edge in Arabic without a second rule.
 */
export function Select({
  children,
  className,
  invalid,
  ...props
}: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          "tap-target rounded-input border-border bg-surface w-full appearance-none border",
          "text-ink py-3 ps-4 pe-11 text-[16px]",
          "transition-colors outline-none",
          "focus-visible:border-accent focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-0",
          "disabled:bg-ink/5 disabled:text-muted-3 disabled:cursor-not-allowed",
          invalid && "border-danger",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute end-4 top-1/2 size-3 -translate-y-1/2",
          "bg-muted [mask-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1 3.5 6 8.5l5-5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")]",
          "[mask-size:contain] [mask-repeat:no-repeat]",
        )}
      />
    </div>
  );
}

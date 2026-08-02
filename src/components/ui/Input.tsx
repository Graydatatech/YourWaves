import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

/**
 * Note the hard-coded 16px font size: iOS Safari auto-zooms the viewport when
 * a focused input renders below 16px, which yanks the user out of the form
 * layout. Never lower this.
 */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "tap-target rounded-input border-border bg-surface w-full border",
        "text-ink placeholder:text-muted-3 px-4 py-3 text-[16px]",
        "transition-colors outline-none",
        "focus-visible:border-accent focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-0",
        "disabled:bg-ink/5 disabled:text-muted-3 disabled:cursor-not-allowed",
        invalid && "border-danger",
        className,
      )}
      {...props}
    />
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PillTone = "brand" | "neutral" | "outline";

const toneClasses: Record<PillTone, string> = {
  brand: "bg-brand text-ink-deep",
  neutral: "bg-accent/10 text-accent",
  outline: "border border-border text-muted",
};

export type PillProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: PillTone;
};

/** Non-interactive badge, so the 44px rule does not apply here. */
export function Pill({
  children,
  className,
  tone = "neutral",
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        "rounded-pill inline-flex items-center gap-1.5 px-3 py-1",
        "text-xs font-semibold whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

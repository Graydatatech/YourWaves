import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** `dark` uses the striped panel treatment from the design tokens. */
  tone?: "surface" | "dark";
};

export function Card({
  children,
  className,
  tone = "surface",
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card p-5 sm:p-6",
        tone === "surface"
          ? "border-border bg-surface shadow-card border"
          : "bg-dark-panel text-white",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

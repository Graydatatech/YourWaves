import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SectionHeadingProps = {
  kicker?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Headings default to h2; pass h1 for the page-level heading. */
  as?: "h1" | "h2" | "h3";
  className?: string;
};

export function SectionHeading({
  kicker,
  title,
  description,
  as: Heading = "h2",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("text-start", className)}>
      {kicker && (
        <p className="text-accent text-xs font-bold tracking-[0.18em] uppercase">
          {kicker}
        </p>
      )}
      <Heading
        className={cn(
          "text-ink mt-2 font-bold",
          Heading === "h1"
            ? "text-[28px] leading-tight sm:text-4xl"
            : "text-2xl leading-tight sm:text-3xl",
        )}
      >
        {title}
      </Heading>
      {description && (
        <p className="text-muted mt-3 text-base leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Kicker + h2 + optional description, shared by every marketing section so the
 * vertical rhythm is identical throughout the page.
 */
export function SectionIntro({
  kicker,
  title,
  description,
  className,
}: {
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl text-start", className)}>
      <p className="text-accent-strong text-xs font-bold tracking-[0.18em] uppercase">
        {kicker}
      </p>
      <h2 className="text-h2 text-ink mt-3">{title}</h2>
      {description && (
        <p className="text-body text-muted mt-4">{description}</p>
      )}
    </div>
  );
}

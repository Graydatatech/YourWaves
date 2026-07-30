import { cn } from "@/lib/cn";

export type SkeletonProps = {
  className?: string;
  /** Renders a stack of lines instead of a single block. */
  lines?: number;
};

/**
 * The shimmer sweep is an absolutely-positioned overlay animated via
 * `inset-inline-start`, so it travels right-to-left in Arabic and
 * left-to-right in English without a direction-specific rule.
 */
export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton
            key={index}
            className={cn(
              "h-4",
              // Ragged last line reads as text rather than a solid block.
              index === lines - 1 ? "w-3/5" : "w-full",
              className,
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-input bg-ink/8 relative h-4 w-full overflow-hidden",
        className,
      )}
    >
      {/* top/bottom are block-axis, so they are direction-neutral. */}
      <span className="animate-shimmer absolute top-0 bottom-0 w-1/2 bg-linear-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}

import { cn } from "@/lib/cn";

/**
 * Teal dot + wordmark. The dot is a plain element rather than an SVG/image so
 * it costs nothing to render and cannot become a layout-shift source.
 */
export function BrandMark({
  label,
  className,
  tone = "ink",
}: {
  label: string;
  className?: string;
  tone?: "ink" | "light";
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="bg-brand size-2.5 shrink-0 rounded-full"
      />
      <span
        className={cn(
          // 20px is the design size and is reached by ~455px wide. Below that
          // it eases down to 17px, which is what keeps the whole header row on
          // one line at 320px once the language pill and hamburger are at
          // their full 44px touch size.
          "font-display text-[clamp(17px,4.4vw,20px)] leading-none font-extrabold tracking-tight whitespace-nowrap",
          tone === "ink" ? "text-ink" : "text-white",
        )}
      >
        {label}
      </span>
    </span>
  );
}

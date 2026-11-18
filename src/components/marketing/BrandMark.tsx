import Image from "next/image";

import { cn } from "@/lib/cn";

import logo from "../../../public/brand/logo.png";
import logoLight from "../../../public/brand/logo-light.png";

/**
 * Logo + wordmark. Both files are generated from brand/logo-source.png by
 * `pnpm gen:brand`; `light` is a white silhouette because the navy figure
 * disappears on the footer's #04202f.
 *
 * The image is decorative (`alt=""`): the wordmark beside it carries the name,
 * and an alt of "YourWaves" would make a screen reader say it twice.
 *
 * Logo height eases 20px → 28px and the wordmark 15px → 20px, both on vw, so
 * the header row still fits at 320px. Measured there, the row had only ~13px
 * of slack before the logo existed, so neither may grow on phones without
 * re-measuring `pnpm check:layout` at 320px in English (the wider locale).
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
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <Image
        src={tone === "ink" ? logo : logoLight}
        alt=""
        // Above the fold, but not LCP: eager without `priority`, which would
        // add a preload competing with the hero poster (CLAUDE.md §2).
        loading="eager"
        sizes="56px"
        className="h-[clamp(20px,6.2vw,28px)] w-auto shrink-0"
      />
      <span
        className={cn(
          // 20px is the design size and is reached by ~455px wide. Below that
          // it eases down to 15px (17px before the logo existed), which is
          // what keeps the whole header row on one line at 320px once the
          // language pill and hamburger are at their full 44px touch size.
          "font-display text-[clamp(15px,4.4vw,20px)] leading-none font-extrabold tracking-tight whitespace-nowrap",
          tone === "ink" ? "text-ink" : "text-white",
        )}
      >
        {label}
      </span>
    </span>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  // Gradient + glow is the single strongest affordance on the page.
  primary: "bg-brand text-ink-deep shadow-cta hover:brightness-105",
  secondary: "glass border border-border text-ink hover:border-accent/40",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
};

const sizeClasses: Record<ButtonSize, string> = {
  // Both clear the 44px touch floor; lg is for the primary page CTA.
  md: "min-h-11 px-5 text-[15px]",
  lg: "min-h-13 px-6 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container — the default shape on mobile. */
  fullWidth?: boolean;
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  fullWidth = false,
  type = "button",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "tap-target rounded-pill inline-flex items-center justify-center gap-2 font-semibold",
        "transition-[filter,background-color,border-color,opacity] duration-200",
        "active:scale-[0.98] motion-reduce:active:scale-100",
        "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

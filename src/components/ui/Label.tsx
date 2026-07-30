import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
  required?: boolean;
};

export function Label({ children, className, required, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-ink block text-start text-sm font-semibold",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="text-accent ms-1" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

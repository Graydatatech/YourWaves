/**
 * Minimal class-name joiner. Deliberately dependency-free — we are not pulling
 * clsx/tailwind-merge in for phase 0. Falsy values are dropped so conditional
 * classes read cleanly: cn("base", isOpen && "open", className)
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

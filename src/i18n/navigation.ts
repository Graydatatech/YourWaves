import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware navigation. Always import Link/redirect/useRouter from here
 * rather than from `next/link` or `next/navigation`, so the active locale
 * prefix is preserved automatically.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

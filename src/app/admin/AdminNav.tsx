"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

/**
 * Navigation, in two shapes.
 *
 * Below 900px (the project's one real breakpoint) it is a BOTTOM TAB BAR, not
 * a sidebar or a hamburger. The ops person is assigning a driver one-handed on
 * a Saturday; the four destinations have to be under a thumb, not behind a menu
 * at the top of a scrolled page.
 *
 * At 900px and up it becomes a left rail. Same links, same order, same active
 * state — the wide layout is the adaptation here, exactly as on the customer
 * site.
 */

type NavItem = {
  href: string;
  key: "overview" | "calendar" | "orders" | "settings";
  icon: React.ReactNode;
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ITEMS: NavItem[] = [
  {
    href: "/admin",
    key: "overview",
    icon: (
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
        <path
          d="M3 10.5 12 4l9 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"
          {...stroke}
        />
        <path d="M9.5 20.5v-6h5v6" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/admin/calendar",
    key: "calendar",
    icon: (
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...stroke} />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/admin/orders",
    key: "orders",
    icon: (
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...stroke} />
        <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" {...stroke} />
      </svg>
    ),
  },
  {
    href: "/admin/settings",
    key: "settings",
    icon: (
      <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" {...stroke} />
        <path
          d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9.1 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.47-1.1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"
          {...stroke}
        />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminBottomTabs() {
  const pathname = usePathname();
  const t = useTranslations("admin");

  return (
    <nav
      aria-label={t("nav.brand")}
      data-testid="admin-bottom-tabs"
      className={cn(
        "border-border bg-surface/95 fixed inset-x-0 bottom-0 z-40 border-t",
        "wide:hidden backdrop-blur-md",
        // Home-indicator inset, so the last row of tabs is not under the bar.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2",
                  "text-[11px] font-semibold transition-colors",
                  active ? "text-accent-strong" : "text-muted-2",
                )}
              >
                {item.icon}
                <span>{t(`nav.${item.key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AdminSidebar({ email }: { email: string | null }) {
  const pathname = usePathname();
  const t = useTranslations("admin");

  return (
    <aside
      data-testid="admin-sidebar"
      className="border-border bg-surface wide:block hidden w-60 shrink-0 border-e"
    >
      <div className="sticky top-0 flex h-dvh flex-col p-4">
        <div className="px-2 pt-1 pb-5">
          <span className="text-ink-deep text-[15px] font-extrabold tracking-tight">
            {t("nav.brand")}
          </span>
        </div>

        <ul className="flex flex-col gap-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold",
                    "transition-colors",
                    active
                      ? "bg-accent/10 text-accent-strong"
                      : "text-muted hover:bg-page hover:text-ink",
                  )}
                >
                  {item.icon}
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-auto">
          {email ? (
            <p className="text-muted-2 truncate px-3 pb-2 text-xs">{email}</p>
          ) : null}
          <form action="/admin/auth/signout" method="post">
            <button
              type="submit"
              className="text-muted hover:text-ink min-h-11 w-full rounded-xl px-3 text-start text-sm font-semibold"
            >
              {t("nav.signOut")}
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

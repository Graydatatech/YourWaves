import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { ADMIN_LOCALE, adminMessages } from "@/lib/admin/intl";
import { AdminBottomTabs, AdminSidebar } from "../../admin/AdminNav";

/**
 * The admin navigation in isolation, for the layout guard.
 *
 * `pnpm check:admin-layout` needs to measure the tab bar and the sidebar at
 * several widths, and every real admin screen requires a session it cannot
 * mint. Rendering the SAME components here — not a copy of them — lets the
 * structural promises (four tabs, pinned to the bottom, 44px, swapped for a
 * sidebar at 900px) be measured rather than asserted.
 *
 * Development only, 404 in production, like /dev/emails and /styleguide.
 */
export default function AdminNavPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <NextIntlClientProvider
      locale={ADMIN_LOCALE}
      messages={adminMessages}
      timeZone="Asia/Qatar"
    >
      <div className="flex min-h-dvh">
        <AdminSidebar email="ops@yourwaves.qa" />
        <div className="min-w-0 flex-1 p-4">
          <p className="text-muted text-sm">
            Navigation preview. Development only.
          </p>
        </div>
      </div>
      <AdminBottomTabs />
    </NextIntlClientProvider>
  );
}

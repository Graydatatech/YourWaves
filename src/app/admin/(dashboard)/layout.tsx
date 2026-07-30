import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin/session";
import { AdminBottomTabs, AdminSidebar } from "../AdminNav";

/**
 * The gate, and the chrome that only signed-in screens get.
 *
 * THREE LAYERS CHECK AUTHORISATION, each covering what the others cannot:
 *
 *   1. src/proxy.ts — sees only the session cookie, but runs before any route
 *      and so makes an anonymous request impossible without a database call.
 *   2. HERE — has the database, so it can ask the two questions the proxy
 *      cannot: has this user passed MFA, and do they have a role at all?
 *   3. requireAdmin() in every API route — because a layout does not run for
 *      a fetch, and the API is what actually mutates anything.
 *
 * Removing any one of them leaves a real hole.
 */
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getAdminSession();

  if (!result.ok) {
    redirect(
      result.reason === "mfa_required_enrol" ||
        result.reason === "mfa_required_challenge"
        ? "/admin/mfa"
        : `/admin/login?reason=${result.reason}`,
    );
  }

  return (
    <div className="flex min-h-dvh">
      <AdminSidebar email={result.session.email} />
      <div className="min-w-0 flex-1">
        {/* The bottom bar is 56px plus the home-indicator inset; this padding
            is what keeps the last card clear of it. */}
        <main className="wide:px-6 wide:pt-6 wide:pb-10 mx-auto max-w-5xl px-4 pt-4 pb-[calc(76px+env(safe-area-inset-bottom))]">
          {children}
        </main>
      </div>
      <AdminBottomTabs />
    </div>
  );
}

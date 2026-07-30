import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  supabaseAuthConfigured,
} from "@/lib/admin/supabase";
import { MfaFlow } from "./MfaFlow";

/**
 * The MFA gate. Reachable with an aal1 session and nothing else — a signed-out
 * visitor is sent to the login form rather than shown a code box for no account.
 */
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!supabaseAuthConfigured()) redirect("/admin/login?reason=not_configured");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const params = await searchParams;
  // Only same-site admin paths, so `?next=` cannot be used as an open redirect.
  const next =
    params.next && params.next.startsWith("/admin") ? params.next : "/admin";

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <MfaFlow next={next} />
    </div>
  );
}

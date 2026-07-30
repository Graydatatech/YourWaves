import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  supabaseAuthConfigured,
} from "@/lib/admin/supabase";

/**
 * POST /admin/auth/signout
 *
 * A POST, not a link. A GET sign-out can be triggered by any image tag or
 * prefetch on a page the admin happens to visit, which is a real (if petty)
 * denial of service against someone mid-dispatch.
 */
export async function POST() {
  if (supabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}

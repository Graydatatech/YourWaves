import { adminT } from "@/lib/admin/intl";
import { supabaseAuthConfigured } from "@/lib/admin/supabase";
import { LoginForm } from "./LoginForm";

/** Sign in. Reachable without a session — see PUBLIC_ADMIN_PATHS in proxy.ts. */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const params = await searchParams;
  const t = adminT();

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="pb-6">
        <p className="text-accent-strong text-xs font-bold tracking-[0.16em] uppercase">
          {t("login.subtitle")}
        </p>
        <h1 className="text-ink-deep pt-1 text-2xl font-extrabold tracking-tight">
          {t("login.title")}
        </h1>
      </div>

      <LoginForm
        configured={supabaseAuthConfigured()}
        initialReason={params.reason}
        next={params.next}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { supabaseBrowser } from "@/lib/admin/supabaseBrowser";
import { cn } from "@/lib/cn";

/**
 * Email + password, then straight into the MFA gate.
 *
 * A successful password check is NOT a successful sign-in here: admin accounts
 * require a second factor, so this always lands on /admin/mfa, which decides
 * whether that means enrolling or challenging. Routing "success" directly to
 * the dashboard would let an aal1 session see a page for the instant it took
 * the layout to redirect.
 */
export function LoginForm({
  configured,
  initialReason,
  next,
}: {
  configured: boolean;
  initialReason?: string;
  next?: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    initialReason === "no_role"
      ? t("login.noRole")
      : initialReason === "not_configured"
        ? t("login.notConfigured")
        : null,
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      const { error: signInError } =
        await supabaseBrowser().auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError) {
        // Supabase does not distinguish "no such user" from "wrong password",
        // and neither does this message — telling an attacker which emails
        // exist is a free gift.
        setError(
          signInError.status === 429
            ? t("login.rateLimited")
            : t("login.invalid"),
        );
        setPending(false);
        return;
      }

      const target = next && next.startsWith("/admin") ? next : "/admin";
      router.replace(`/admin/mfa?next=${encodeURIComponent(target)}`);
    } catch {
      setError(t("login.notConfigured"));
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <p className="border-border bg-surface text-muted rounded-card border p-4 text-sm leading-relaxed">
        {t("login.notConfigured")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-ink text-sm font-semibold">
          {t("login.email")}
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={cn(
            "border-border bg-surface rounded-input min-h-12 border px-3.5",
            // 16px: anything smaller and iOS Safari zooms the viewport on focus.
            "focus:border-accent text-base outline-none",
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-ink text-sm font-semibold">
          {t("login.password")}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={cn(
            "border-border bg-surface rounded-input min-h-12 border px-3.5",
            "focus:border-accent text-base outline-none",
          )}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-input bg-[#fdeceb] px-3.5 py-2.5 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={cn(
          "bg-accent rounded-pill min-h-12 px-6 text-base font-bold text-white",
          "disabled:opacity-60",
        )}
      >
        {pending ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}

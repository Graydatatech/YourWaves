"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { AdminUserRow } from "@/lib/admin/types";
import { ConfirmSheet } from "../../components/ConfirmSheet";

const FIELD = cn(
  "border-border bg-surface rounded-input min-h-11 w-full border px-3",
  // 16px minimum: a smaller input makes iOS Safari zoom the viewport on focus.
  "text-base outline-none focus:border-accent",
);

/**
 * Back-office accounts.
 *
 * Replaces `node scripts/create-admin.mjs`, which is fine for bootstrapping the
 * first admin on a laptop and wrong for adding a colleague at launch.
 *
 * THE PASSWORD IS SHOWN ONCE AND CANNOT BE RECOVERED. `auth.users` stores a
 * bcrypt hash, so there is nothing to show again — the remedy for losing it is
 * to add the account a second time, which resets it. The panel therefore keeps
 * the credential on screen until it is explicitly dismissed, rather than
 * clearing it on the next render or a route change, because a toast that
 * disappears takes the only copy with it.
 */
export function AdminsPanel({ admins }: { admins: AdminUserRow[] }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<AdminUserRow | null>(null);

  async function addAdmin() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        setError(t(`admins.errors.${body?.error ?? "failed"}`));
        return;
      }
      setCreated({ email: body.email, password: body.password });
      setEmail("");
      router.refresh();
    } catch {
      setError(t("admins.errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(row: AdminUserRow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/admins/${row.userId}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        setError(t(`admins.errors.${body?.error ?? "failed"}`));
        return;
      }
      router.refresh();
    } catch {
      setError(t("admins.errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <h2 className="text-ink-deep text-sm font-bold">{t("admins.title")}</h2>
      <p className="text-muted-2 pt-1 text-sm">{t("admins.subtitle")}</p>

      {/* The list ---------------------------------------------------------- */}
      <ul className="divide-border mt-3 divide-y">
        {admins.map((row) => (
          <li
            key={row.userId}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-ink text-sm font-semibold break-all">
                {row.email}
                {row.isSelf && (
                  <span className="text-muted-2 ps-2 text-xs font-bold">
                    {t("admins.you")}
                  </span>
                )}
              </p>
              <p className="text-muted-2 text-xs">
                {row.lastSignInAt
                  ? t("admins.lastSignIn", {
                      when: new Date(row.lastSignInAt).toLocaleString("en-GB", {
                        timeZone: "Asia/Qatar",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })
                  : t("admins.neverSignedIn")}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* An admin who has not enrolled TOTP is treated as signed out by
                  getAdminSession, so this is the difference between "invited"
                  and "actually using it". */}
              <span
                className={cn(
                  "rounded-pill border px-2 py-0.5 text-xs font-bold",
                  row.mfaEnrolled
                    ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
                    : "border-[#fcd9a4] bg-[#fff7ed] text-[#92400e]",
                )}
              >
                {row.mfaEnrolled ? t("admins.mfaOn") : t("admins.mfaPending")}
              </span>

              {!row.isSelf && admins.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPendingRevoke(row)}
                  disabled={busy}
                  className="text-danger min-h-11 text-sm font-bold underline disabled:opacity-45"
                >
                  {t("admins.revoke")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Add --------------------------------------------------------------- */}
      <div className="border-border mt-3 border-t pt-3">
        <label
          htmlFor="new-admin-email"
          className="text-ink block text-sm font-semibold"
        >
          {t("admins.addLabel")}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="new-admin-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            dir="ltr"
            className={cn(FIELD, "min-w-0 flex-1")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
          <button
            type="button"
            onClick={addAdmin}
            disabled={busy || !email.trim()}
            className={cn(
              "rounded-pill min-h-11 shrink-0 px-4 text-sm font-bold",
              "bg-[#097182] text-white disabled:opacity-45",
            )}
          >
            {busy ? t("common.saving") : t("admins.add")}
          </button>
        </div>
        <p className="text-muted-2 pt-1 text-xs">{t("admins.addHint")}</p>
      </div>

      {error && (
        <p role="alert" className="text-danger pt-2 text-sm font-semibold">
          {error}
        </p>
      )}

      {/* The one-time credential ------------------------------------------- */}
      {created && (
        <div
          role="status"
          className="rounded-input mt-3 border border-[#a7f3d0] bg-[#ecfdf5] p-3"
        >
          <p className="text-sm font-bold text-[#065f46]">
            {t("admins.createdTitle")}
          </p>
          <dl className="mt-2 text-sm text-[#065f46]">
            <dt className="text-xs font-bold uppercase opacity-80">
              {t("admins.emailLabel")}
            </dt>
            <dd dir="ltr" className="font-mono break-all">
              {created.email}
            </dd>
            <dt className="pt-2 text-xs font-bold uppercase opacity-80">
              {t("admins.passwordLabel")}
            </dt>
            <dd dir="ltr" className="font-mono text-base break-all select-all">
              {created.password}
            </dd>
          </dl>
          <p className="pt-2 text-xs text-[#065f46]">
            {t("admins.createdHint")}
          </p>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="min-h-11 text-sm font-bold text-[#065f46] underline"
          >
            {t("admins.dismiss")}
          </button>
        </div>
      )}

      <ConfirmSheet
        open={pendingRevoke !== null}
        tone="danger"
        title={t("admins.revokeTitle")}
        body={t("admins.revokeBody", { email: pendingRevoke?.email ?? "" })}
        confirmLabel={t("admins.revoke")}
        pending={busy}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const row = pendingRevoke;
          setPendingRevoke(null);
          if (row) void revoke(row);
        }}
      />
    </section>
  );
}

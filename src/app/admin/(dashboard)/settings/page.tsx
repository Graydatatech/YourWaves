import { getAdminSession } from "@/lib/admin/session";
import {
  getAdminSettings,
  getDrivers,
  getSettingsAudit,
} from "@/lib/admin/queries";
import { adminT } from "@/lib/admin/intl";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

/** Settings, plus the audit trail of who last changed what. */
export default async function AdminSettingsPage() {
  const result = await getAdminSession();
  if (!result.ok) return null;

  const t = adminT();
  const [settings, drivers, audit] = await Promise.all([
    getAdminSettings(result.session),
    getDrivers(result.session),
    getSettingsAudit(result.session),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-ink-deep text-xl font-extrabold tracking-tight">
        {t("settings.title")}
      </h1>

      <SettingsForm settings={settings} drivers={drivers} />

      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.audit")}
        </h2>

        {audit.length === 0 ? (
          <p className="text-muted-2 pt-2 text-sm">
            {t("settings.auditEmpty")}
          </p>
        ) : (
          <ul className="divide-border mt-2 divide-y">
            {audit.map((entry) => (
              <li key={entry.id} className="py-2.5 text-sm">
                <p className="text-ink">
                  {t("settings.auditEntry", {
                    name: entry.actorName ?? "—",
                    keys: entry.changedKeys.join(", "),
                  })}
                </p>
                <p className="text-muted-2 text-xs tabular-nums">
                  {new Date(entry.createdAt).toLocaleString("en-GB", {
                    timeZone: "Asia/Qatar",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { getAdminSession } from "@/lib/admin/session";
import { getOverview, OPERATIONAL_STATUSES } from "@/lib/admin/queries";
import { adminT } from "@/lib/admin/intl";
import { formatMoney, formatShortDate, formatTime } from "@/lib/booking/format";
import { StatusPill } from "../components/StatusPill";
import { PullToRefresh } from "../components/PullToRefresh";
import { TodayCard } from "./TodayCard";

export const dynamic = "force-dynamic";

/**
 * Overview — what an ops person needs in the first three seconds.
 *
 * Order is deliberate and mobile-first: today's job, then what needs a driver,
 * then the numbers. Counts and revenue are context; the job and the unassigned
 * list are work.
 */
export default async function AdminOverviewPage() {
  const result = await getAdminSession();
  if (!result.ok) return null; // The layout has already redirected.

  const t = adminT();
  const data = await getOverview(result.session);

  const featured = data.todaysBooking ?? data.nextBooking;

  return (
    <PullToRefresh>
      <div className="flex flex-col gap-4">
        <h1 className="text-ink-deep text-xl font-extrabold tracking-tight">
          {t("overview.title")}
        </h1>

        {featured ? (
          <TodayCard
            booking={featured}
            heading={
              data.todaysBooking
                ? t("overview.todayTitle")
                : t("overview.nextTitle")
            }
          />
        ) : (
          <section className="border-border bg-surface rounded-card border p-5">
            <h2 className="text-ink-deep text-lg font-bold">
              {t("overview.noJobs")}
            </h2>
            <p className="text-muted pt-1 text-sm">
              {t("overview.noJobsBody")}
            </p>
          </section>
        )}

        {/* Two summary tiles. Side by side even at 320px — they are short
            numbers, and stacking them pushes the work below the fold. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="border-border bg-surface rounded-card border p-4">
            <p className="text-muted-2 text-xs font-bold tracking-[0.12em] uppercase">
              {t("overview.weekRevenue")}
            </p>
            <p className="text-ink-deep pt-1.5 text-xl font-extrabold tabular-nums">
              {formatMoney(
                data.weekRevenue.total,
                data.weekRevenue.currency,
                "en",
              )}
            </p>
            <p className="text-muted-2 pt-0.5 text-xs">
              {t("overview.weekRevenueHint", {
                count: data.weekRevenue.bookings,
              })}
            </p>
          </div>

          <div className="border-border bg-surface rounded-card border p-4">
            <p className="text-muted-2 text-xs font-bold tracking-[0.12em] uppercase">
              {t("overview.activeDrivers")}
            </p>
            <p className="text-ink-deep pt-1.5 text-xl font-extrabold tabular-nums">
              {data.activeDrivers}
            </p>
            <Link
              href="/admin/settings#drivers"
              className="text-accent-strong inline-flex min-h-11 items-center text-xs font-semibold underline"
            >
              {t("settings.drivers")}
            </Link>
          </div>
        </div>

        <section className="border-border bg-surface rounded-card border p-4">
          <h2 className="text-ink-deep text-sm font-bold">
            {t("overview.needsDriver")}
          </h2>

          {data.needsDriver.length === 0 ? (
            <p className="text-muted pt-2 text-sm">
              {t("overview.needsDriverEmpty")}
            </p>
          ) : (
            <ul className="divide-border mt-2 divide-y">
              {data.needsDriver.map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/admin/bookings/${booking.reference}`}
                    className="flex min-h-14 items-center justify-between gap-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="text-ink block truncate text-sm font-semibold">
                        {booking.customerName}
                      </span>
                      <span className="text-muted-2 block text-xs tabular-nums">
                        {formatShortDate(booking.bookingDate, "en")} ·{" "}
                        {formatTime(booking.preferredStart, "en")}
                      </span>
                    </span>
                    <span className="text-accent-strong shrink-0 text-xs font-bold">
                      {t("booking.assign")} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-border bg-surface rounded-card border p-4">
          <h2 className="text-ink-deep text-sm font-bold">
            {t("overview.countsTitle")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {OPERATIONAL_STATUSES.map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <StatusPill status={status} />
                <span className="text-ink text-sm font-bold tabular-nums">
                  {data.counts[status] ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PullToRefresh>
  );
}

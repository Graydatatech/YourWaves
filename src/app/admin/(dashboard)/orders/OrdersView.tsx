"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatMoney, formatShortDate, formatTime } from "@/lib/booking/format";
import {
  OPERATIONAL_STATUSES,
  type BookingSummary,
  type DriverRow,
  type OrdersResult,
} from "@/lib/admin/types";
import { StatusPill } from "../../components/StatusPill";
import { cn } from "@/lib/cn";

/**
 * Orders — the searchable ledger.
 *
 * BELOW 900px THIS IS A CARD LIST, not a table. A table with seven columns on a
 * 390px screen leaves two choices, and both are bad: shrink the type until it
 * cannot be read, or scroll horizontally, which hides columns behind a gesture
 * nobody discovers. The cards carry the same fields in reading order —
 * reference, date and status on top, customer and address below.
 *
 * All filter state lives in the URL. That makes a filtered view shareable
 * ("look at Thursday's unassigned"), survives the back button, and means the
 * CSV export can simply reuse the query string.
 */

const FIELD = cn(
  "border-border bg-surface rounded-input min-h-11 border px-3",
  // 16px on mobile so iOS does not zoom; the input is still compact at wide:.
  "text-base wide:text-sm outline-none focus:border-accent",
);

export function OrdersView({
  result,
  drivers,
  cities,
}: {
  result: OrdersResult;
  drivers: DriverRow[];
  cities: string[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(params.get("search") ?? "");

  /** Writes one filter into the URL, resetting to page 1. */
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "" || value === "all") next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");

    startTransition(() => {
      router.replace(`/admin/orders?${next.toString()}`, { scroll: false });
    });
  }

  const exportHref = `/api/admin/orders?${new URLSearchParams({
    ...Object.fromEntries(params.entries()),
    format: "csv",
  }).toString()}`;

  const from = (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.page * result.pageSize, result.total);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-ink-deep text-xl font-extrabold tracking-tight">
          {t("orders.title")}
        </h1>
        <a
          href={exportHref}
          className="border-border text-ink rounded-pill flex min-h-11 items-center border px-4 text-sm font-semibold"
        >
          {t("orders.export")}
        </a>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setParam("search", search);
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("orders.searchPlaceholder")}
          aria-label={t("common.search")}
          className={cn(FIELD, "flex-1")}
        />
        <button
          type="submit"
          className="bg-accent rounded-pill min-h-11 px-4 text-sm font-bold text-white"
        >
          {t("common.search")}
        </button>
      </form>

      {/* Filters collapse into a <details> on mobile: four selects always open
          would push the results themselves off the screen. */}
      <details
        className="border-border bg-surface rounded-card wide:open:[&>summary]:mb-0 border"
        open
      >
        <summary className="text-ink tap-target flex cursor-pointer items-center px-4 text-sm font-bold">
          {t("orders.filters")}
        </summary>

        <div className="wide:grid-cols-4 grid grid-cols-2 gap-3 p-4 pt-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.status")}
            </span>
            <select
              value={params.get("status") ?? "all"}
              onChange={(event) => setParam("status", event.target.value)}
              className={FIELD}
            >
              <option value="all">{t("common.all")}</option>
              {OPERATIONAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.driver")}
            </span>
            <select
              value={params.get("driver") ?? "all"}
              onChange={(event) => setParam("driver", event.target.value)}
              className={FIELD}
            >
              <option value="all">{t("common.all")}</option>
              <option value="unassigned">{t("common.unassigned")}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.city")}
            </span>
            <select
              value={params.get("city") ?? "all"}
              onChange={(event) => setParam("city", event.target.value)}
              className={FIELD}
            >
              <option value="all">{t("common.all")}</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.sortDate")}
            </span>
            <select
              value={`${params.get("sort") ?? "date"}:${params.get("direction") ?? "desc"}`}
              onChange={(event) => {
                const [sort, direction] = event.target.value.split(":");
                const next = new URLSearchParams(params.toString());
                next.set("sort", sort);
                next.set("direction", direction);
                next.delete("page");
                startTransition(() =>
                  router.replace(`/admin/orders?${next.toString()}`, {
                    scroll: false,
                  }),
                );
              }}
              className={FIELD}
            >
              <option value="date:desc">{t("orders.sortDate")} ↓</option>
              <option value="date:asc">{t("orders.sortDate")} ↑</option>
              <option value="created:desc">{t("orders.sortCreated")} ↓</option>
              <option value="amount:desc">{t("orders.sortAmount")} ↓</option>
              <option value="reference:desc">
                {t("orders.sortReference")} ↓
              </option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.from")}
            </span>
            <input
              type="date"
              value={params.get("from") ?? ""}
              onChange={(event) => setParam("from", event.target.value)}
              className={FIELD}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-2 text-xs font-semibold">
              {t("orders.to")}
            </span>
            <input
              type="date"
              value={params.get("to") ?? ""}
              onChange={(event) => setParam("to", event.target.value)}
              className={FIELD}
            />
          </label>

          <div className="wide:col-span-2 col-span-2 flex items-end">
            <button
              type="button"
              onClick={() => {
                setSearch("");
                startTransition(() =>
                  router.replace("/admin/orders", { scroll: false }),
                );
              }}
              className="border-border text-ink rounded-pill min-h-11 border px-4 text-sm font-semibold"
            >
              {t("orders.clear")}
            </button>
          </div>
        </div>
      </details>

      <div
        aria-busy={isPending}
        className={cn("transition-opacity", isPending && "opacity-60")}
      >
        {result.rows.length === 0 ? (
          <p className="border-border bg-surface text-muted rounded-card border p-4 text-sm">
            {t("orders.empty")}
          </p>
        ) : (
          <>
            {/* Cards: the mobile shape. */}
            <ul className="wide:hidden flex flex-col gap-2">
              {result.rows.map((booking) => (
                <li key={booking.id}>
                  <OrderCard booking={booking} />
                </li>
              ))}
            </ul>

            {/* Table: only where there is room for it. */}
            <div className="border-border bg-surface rounded-card wide:block hidden overflow-hidden border">
              <table className="w-full text-sm">
                <thead className="border-border bg-page border-b">
                  <tr className="text-muted-2 text-xs">
                    <th className="px-3 py-2 text-start font-bold">
                      {t("orders.columnReference")}
                    </th>
                    <th className="px-3 py-2 text-start font-bold">
                      {t("orders.columnDate")}
                    </th>
                    <th className="px-3 py-2 text-start font-bold">
                      {t("orders.columnCustomer")}
                    </th>
                    <th className="px-3 py-2 text-start font-bold">
                      {t("orders.columnStatus")}
                    </th>
                    <th className="px-3 py-2 text-start font-bold">
                      {t("orders.columnDriver")}
                    </th>
                    <th className="px-3 py-2 text-end font-bold">
                      {t("orders.columnTotal")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {result.rows.map((booking) => (
                    <tr key={booking.id} className="hover:bg-page">
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/bookings/${booking.reference}`}
                          className="text-accent-strong font-bold tabular-nums"
                        >
                          {booking.reference}
                        </Link>
                      </td>
                      <td className="text-ink px-3 py-2 tabular-nums">
                        {formatShortDate(booking.bookingDate, "en")}
                        <span className="text-muted-2">
                          {" "}
                          {formatTime(booking.preferredStart, "en")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-ink block font-semibold">
                          {booking.customerName}
                        </span>
                        <span className="text-muted-2 block text-xs">
                          {booking.area ?? booking.city ?? ""}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={booking.status} />
                      </td>
                      <td className="text-ink px-3 py-2">
                        {booking.driverName ?? (
                          <span className="text-muted-2">
                            {t("common.unassigned")}
                          </span>
                        )}
                      </td>
                      <td className="text-ink px-3 py-2 text-end font-semibold tabular-nums">
                        {formatMoney(
                          booking.priceTotal,
                          booking.currency,
                          "en",
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {result.total > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-2 text-xs tabular-nums">
            {t("orders.showing", { from, to, total: result.total })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={result.page <= 1}
              onClick={() => setParam("page", String(result.page - 1))}
              className="border-border text-ink rounded-pill min-h-11 border px-4 text-sm font-semibold disabled:opacity-40"
            >
              {t("orders.prev")}
            </button>
            <button
              type="button"
              disabled={result.page >= result.pageCount}
              onClick={() => setParam("page", String(result.page + 1))}
              className="border-border text-ink rounded-pill min-h-11 border px-4 text-sm font-semibold disabled:opacity-40"
            >
              {t("orders.next")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OrderCard({ booking }: { booking: BookingSummary }) {
  const t = useTranslations("admin");

  return (
    <Link
      href={`/admin/bookings/${booking.reference}`}
      className="border-border bg-surface rounded-card block border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-accent-strong text-sm font-bold tabular-nums">
          {booking.reference}
        </span>
        <StatusPill status={booking.status} />
      </div>

      <p className="text-muted-2 pt-1 text-xs tabular-nums">
        {formatShortDate(booking.bookingDate, "en")} ·{" "}
        {formatTime(booking.preferredStart, "en")}
      </p>

      <p className="text-ink truncate pt-1.5 text-sm font-semibold">
        {booking.customerName}
      </p>
      <p className="text-muted truncate text-xs">
        {[booking.addressLine, booking.area].filter(Boolean).join(", ")}
      </p>

      <div className="border-border mt-2 flex items-center justify-between border-t pt-2">
        <span className="text-muted-2 text-xs">
          {booking.driverName ?? t("common.unassigned")}
        </span>
        <span className="text-ink text-sm font-bold tabular-nums">
          {formatMoney(booking.priceTotal, booking.currency, "en")}
        </span>
      </div>
    </Link>
  );
}

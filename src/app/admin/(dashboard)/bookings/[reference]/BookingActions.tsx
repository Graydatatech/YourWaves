"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ADMIN_TRANSITIONS,
  type BookingStatus,
  type DriverRow,
} from "@/lib/admin/types";
import { ConfirmSheet } from "../../../components/ConfirmSheet";
import { cn } from "@/lib/cn";

/**
 * Status control and driver dispatch — the two things this screen exists for.
 *
 * The transition buttons are derived from ADMIN_TRANSITIONS, so an illegal move
 * is not merely disabled, it is never rendered. That is a convenience for the
 * operator, NOT the safeguard: the endpoint re-derives what is legal and the
 * SQL function raises on anything else, so a hand-written POST is refused too.
 * `tests/admin-transitions.test.ts` proves that directly.
 */
export function BookingActions({
  reference,
  status,
  driverId,
  drivers,
}: {
  reference: string;
  status: BookingStatus;
  driverId: string | null;
  drivers: DriverRow[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [target, setTarget] = useState<BookingStatus | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(driverId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moves = ADMIN_TRANSITIONS[status];
  const advance = moves.filter((move) => move !== "cancelled");
  const canCancel = moves.includes("cancelled");
  const activeDrivers = drivers.filter(
    (driver) => driver.isActive || driver.id === driverId,
  );

  async function runTransition(to: BookingStatus) {
    setPendingAction(true);
    setError(null);
    setMessage(null);

    const response = await fetch(
      `/api/admin/bookings/${reference}/transition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      },
    );

    setPendingAction(false);
    setTarget(null);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
        from?: BookingStatus;
      };
      setError(
        detail.error === "illegal_transition" && detail.from
          ? t("booking.illegal", { status: t(`status.${detail.from}`) })
          : t("common.error"),
      );
      return;
    }

    router.refresh();
  }

  async function dispatchDriver() {
    if (!selectedDriver) return;

    setPendingAction(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/admin/bookings/${reference}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: selectedDriver }),
    });

    const detail = (await response.json().catch(() => ({}))) as {
      outcome?: string;
      error?: string;
    };
    setPendingAction(false);

    if (!response.ok) {
      setError(
        detail.outcome === "DRIVER_INACTIVE"
          ? t("booking.driverInactive")
          : detail.outcome === "BOOKING_NOT_DISPATCHABLE"
            ? t("booking.notDispatchable")
            : t("common.error"),
      );
      return;
    }

    const name =
      drivers.find((driver) => driver.id === selectedDriver)?.fullName ?? "";
    setMessage(
      detail.outcome === "REASSIGNED"
        ? t("booking.reassigned", { name })
        : t("booking.assigned", { name }),
    );
    router.refresh();
  }

  const terminal = moves.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("booking.statusTitle")}
        </h2>

        {terminal ? (
          <p className="text-muted pt-2 text-sm">
            {t("booking.terminal", { status: t(`status.${status}`) })}
          </p>
        ) : (
          <div className="flex flex-col gap-2 pt-3">
            {advance.map((move) => (
              <button
                key={move}
                type="button"
                onClick={() => setTarget(move)}
                className="bg-accent rounded-pill min-h-12 px-6 text-base font-bold text-white"
              >
                {t("booking.advanceTo", { status: t(`status.${move}`) })}
              </button>
            ))}

            {canCancel ? (
              <button
                type="button"
                onClick={() => setTarget("cancelled")}
                className={cn(
                  "rounded-pill min-h-12 border border-[#f5c2be] px-6",
                  "text-base font-semibold text-[#b3261e]",
                )}
              >
                {t("booking.cancelBooking")}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("booking.dispatch")}
        </h2>

        {activeDrivers.length === 0 ? (
          <p className="text-muted pt-2 text-sm">
            {t("booking.noDriversActive")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 pt-3">
            <label htmlFor="driver" className="sr-only">
              {t("booking.selectDriver")}
            </label>
            {/* A native <select>: the platform picker is a full-height wheel on
                iOS and a proper list on Android, both better than anything a
                custom dropdown would give for the 4G budget. */}
            <select
              id="driver"
              value={selectedDriver}
              onChange={(event) => setSelectedDriver(event.target.value)}
              className={cn(
                "border-border bg-surface rounded-input min-h-12 border px-3",
                "focus:border-accent text-base outline-none",
              )}
            >
              <option value="">{t("booking.selectDriver")}</option>
              {activeDrivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                  {driver.activeJobs > 0
                    ? ` · ${t("settings.driverJobs", { count: driver.activeJobs })}`
                    : ""}
                  {driver.isActive ? "" : ` · ${t("settings.inactive")}`}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={dispatchDriver}
              disabled={
                pendingAction || !selectedDriver || selectedDriver === driverId
              }
              className={cn(
                "rounded-pill min-h-12 px-6 text-base font-bold text-white",
                "bg-accent disabled:opacity-50",
              )}
            >
              {driverId ? t("booking.reassign") : t("booking.assign")}
            </button>
          </div>
        )}
      </section>

      {message ? (
        <p
          role="status"
          className="rounded-input bg-[#ecfdf5] px-3.5 py-2.5 text-sm text-[#065f46]"
        >
          {message}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-input bg-[#fdeceb] px-3.5 py-2.5 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}

      <ConfirmSheet
        open={target !== null}
        pending={pendingAction}
        tone={target === "cancelled" ? "danger" : "default"}
        title={t("booking.confirmTitle", {
          status: target ? t(`status.${target}`) : "",
        })}
        body={
          target === "cancelled"
            ? t("booking.confirmCancelBody")
            : t("booking.confirmBody")
        }
        confirmLabel={
          target === "cancelled"
            ? t("booking.cancelBooking")
            : t("booking.advanceTo", {
                status: target ? t(`status.${target}`) : "",
              })
        }
        onConfirm={() => target && runTransition(target)}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}

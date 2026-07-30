"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatFullDate, formatTime } from "@/lib/booking/format";
import {
  ADMIN_TRANSITIONS,
  type BookingStatus,
  type BookingSummary,
} from "@/lib/admin/types";
import { StatusPill } from "../components/StatusPill";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { ContactActions } from "../components/ContactActions";
import { buildAdminMapsLink } from "@/lib/admin/maps";
import { cn } from "@/lib/cn";

/**
 * The big card at the top of the overview.
 *
 * "One-tap advance" is the point: the next legal status is a single primary
 * button, not a dropdown to open and a form to submit. On the day, the ops
 * person is moving one booking through assigned → en route → completed and
 * nothing else.
 *
 * The confirmation sheet is not friction for its own sake — each advance sends
 * the customer a WhatsApp message, and an accidental "completed" at 9am is not
 * retractable.
 */
export function TodayCard({
  booking,
  heading,
}: {
  booking: BookingSummary;
  heading: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [target, setTarget] = useState<BookingStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first non-cancel move is the one worth a big button.
  const next = ADMIN_TRANSITIONS[booking.status].find(
    (status) => status !== "cancelled",
  );

  async function advance(to: BookingStatus) {
    setPending(true);
    setError(null);

    const response = await fetch(
      `/api/admin/bookings/${booking.reference}/transition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      },
    );

    setPending(false);
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

  return (
    <section className="border-border bg-surface rounded-card wide:p-5 border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-accent-strong text-xs font-bold tracking-[0.14em] uppercase">
            {heading}
          </p>
          <h2 className="text-ink-deep truncate pt-1 text-xl font-extrabold tracking-tight">
            {booking.customerName}
          </h2>
          <p className="text-muted pt-0.5 text-sm">
            {formatFullDate(booking.bookingDate, "en")} ·{" "}
            {formatTime(booking.preferredStart, "en")}
          </p>
        </div>
        <StatusPill status={booking.status} size="md" />
      </div>

      <dl className="border-border mt-4 grid gap-2 border-t pt-4 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-2 w-20 shrink-0">{t("booking.call")}</dt>
          <dd className="text-ink font-semibold">{booking.customerPhone}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-2 w-20 shrink-0">
            {t("booking.location")}
          </dt>
          <dd className="text-ink min-w-0">
            {[booking.addressLine, booking.area].filter(Boolean).join(", ")}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-2 w-20 shrink-0">{t("overview.driver")}</dt>
          <dd
            className={cn(
              "font-semibold",
              booking.driverName ? "text-ink" : "text-[#92400e]",
            )}
          >
            {booking.driverName ?? t("overview.noDriver")}
          </dd>
        </div>
      </dl>

      <ContactActions
        className="mt-4"
        phone={booking.customerPhone}
        mapsHref={buildAdminMapsLink(booking)}
      />

      {error ? (
        <p
          role="alert"
          className="rounded-input mt-3 bg-[#fdeceb] px-3 py-2 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {next ? (
          <button
            type="button"
            onClick={() => setTarget(next)}
            className="bg-accent rounded-pill min-h-12 px-6 text-base font-bold text-white"
          >
            {t("overview.advance", { status: t(`status.${next}`) })}
          </button>
        ) : null}

        <Link
          href={`/admin/bookings/${booking.reference}`}
          className={cn(
            "border-border text-ink rounded-pill flex min-h-12 items-center",
            "justify-center border px-6 text-base font-semibold",
          )}
        >
          {t("overview.open")}
        </Link>
      </div>

      <ConfirmSheet
        open={target !== null}
        pending={pending}
        title={t("booking.confirmTitle", {
          status: target ? t(`status.${target}`) : "",
        })}
        body={t("booking.confirmBody")}
        confirmLabel={t("overview.advance", {
          status: target ? t(`status.${target}`) : "",
        })}
        onConfirm={() => target && advance(target)}
        onCancel={() => setTarget(null)}
      />
    </section>
  );
}

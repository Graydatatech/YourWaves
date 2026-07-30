import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/admin/session";
import { getBookingDetail, getDrivers } from "@/lib/admin/queries";
import { notificationsForBooking } from "@/lib/notifications/queries";
import { adminT } from "@/lib/admin/intl";
import { formatFullDate, formatMoney, formatTime } from "@/lib/booking/format";
import { StatusPill } from "../../../components/StatusPill";
import { ContactActions } from "../../../components/ContactActions";
import { buildAdminMapsLink } from "@/lib/admin/maps";
import { BookingActions } from "./BookingActions";
import { NotesPanel } from "./NotesPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { DispatchPanel } from "./DispatchPanel";
import { dispatchesForBooking, photosForBooking } from "@/lib/admin/dispatch";
import { renderWhatsApp } from "@/lib/notifications/render";

export const dynamic = "force-dynamic";

/**
 * The booking detail screen — the workhorse.
 *
 * Single column on a phone in priority order: who and where (so they can be
 * called), then the actions, then the record. On wide screens the record moves
 * into a second column so the actions stay in view while reading the audit
 * trail.
 */
export default async function AdminBookingPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const result = await getAdminSession();
  if (!result.ok) return null;

  const { reference } = await params;
  const t = adminT();

  const bundle = await getBookingDetail(result.session, reference);
  if (!bundle) notFound();

  const { booking, payments, events, notes } = bundle;
  const [drivers, notifications, dispatches, photos] = await Promise.all([
    getDrivers(result.session),
    notificationsForBooking(booking.id),
    dispatchesForBooking(result.session, booking.id),
    photosForBooking(result.session, booking.id),
  ]);

  /**
   * The message preview, rendered by the SAME function the worker uses, from a
   * placeholder token — so what an admin reads here is what a recipient gets,
   * minus a real capability link. Showing a live token in the dashboard would
   * put a working key in every screenshot.
   */
  const previewPayload = {
    reference: booking.reference,
    booking_date: booking.bookingDate,
    preferred_start: booking.preferredStart,
    customer_name: booking.customerName,
    customer_phone: booking.customerPhone,
    area: booking.area ?? undefined,
    city: booking.city ?? undefined,
    address_line: booking.addressLine,
    lat: booking.lat ?? undefined,
    lng: booking.lng ?? undefined,
    price_total: booking.priceTotal,
    currency: booking.currency,
    status: booking.status,
    dispatch_token: "EXAMPLE-TOKEN",
  };
  const previewEn =
    renderWhatsApp("dispatch_job", "en", previewPayload)?.preview ?? "";
  const previewAr =
    renderWhatsApp("dispatch_job", "ar", previewPayload)?.preview ?? "";

  const mapsHref = buildAdminMapsLink(booking);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/admin/orders"
          className="text-muted-2 hover:text-ink inline-flex min-h-11 items-center text-xs font-semibold"
        >
          ← {t("orders.title")}
        </Link>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <h1 className="text-ink-deep text-xl font-extrabold tracking-tight tabular-nums">
            {booking.reference}
          </h1>
          <StatusPill status={booking.status} size="md" />
        </div>
        <p className="text-muted pt-1 text-sm">
          {formatFullDate(booking.bookingDate, "en")} ·{" "}
          {formatTime(booking.preferredStart, "en")}
        </p>
      </div>

      <div className="wide:grid-cols-2 wide:items-start grid gap-4">
        {/* --- Column one: act on it ------------------------------------- */}
        <div className="flex flex-col gap-4">
          <section className="border-border bg-surface rounded-card border p-4">
            <h2 className="text-ink-deep text-sm font-bold">
              {t("booking.customer")}
            </h2>
            <dl className="grid gap-2 pt-3 text-sm">
              <Row
                label={t("orders.columnCustomer")}
                value={booking.customerName}
              />
              <Row
                label={t("booking.call")}
                value={booking.customerPhone}
                mono
              />
              {booking.customerEmail ? (
                <Row label={t("booking.email")} value={booking.customerEmail} />
              ) : null}
              <Row
                label={t("booking.locale")}
                value={booking.locale === "ar" ? "العربية" : "English"}
              />
              {booking.phoneVerifiedAt ? (
                <Row
                  label={t("booking.verified")}
                  value={new Date(booking.phoneVerifiedAt).toLocaleDateString(
                    "en-GB",
                    { timeZone: "Asia/Qatar", dateStyle: "medium" },
                  )}
                />
              ) : null}
            </dl>

            <h3 className="text-ink-deep pt-4 text-sm font-bold">
              {t("booking.location")}
            </h3>
            <p className="text-ink pt-2 text-sm">
              {[booking.addressLine, booking.area, booking.city]
                .filter(Boolean)
                .join(", ")}
            </p>
            {booking.notes ? (
              <p className="rounded-input mt-2 bg-[#fff7ed] px-3 py-2 text-sm text-[#92400e]">
                <span className="font-bold">{t("booking.customerNotes")}:</span>{" "}
                {booking.notes}
              </p>
            ) : null}

            <ContactActions
              className="mt-3"
              phone={booking.customerPhone}
              mapsHref={mapsHref}
            />
          </section>

          <BookingActions
            reference={booking.reference}
            status={booking.status}
            driverId={booking.driverId}
            drivers={drivers}
          />
        </div>

        {/* --- Column two: the record ------------------------------------ */}
        <div className="flex flex-col gap-4">
          <section className="border-border bg-surface rounded-card border p-4">
            <h2 className="text-ink-deep text-sm font-bold">
              {t("booking.payment")}
            </h2>

            <dl className="grid gap-2 pt-3 text-sm">
              <Row
                label={t("booking.priceRental")}
                value={formatMoney(booking.priceRental, booking.currency, "en")}
              />
              {/* Only for bookings taken under the old three-part price. Since
                  0012 these are zero, and a row of "QAR 0" tells nobody
                  anything — but a booking from before the change must still
                  show what its customer was actually charged for. */}
              {booking.priceSetup > 0 ? (
                <Row
                  label={t("booking.priceSetup")}
                  value={formatMoney(
                    booking.priceSetup,
                    booking.currency,
                    "en",
                  )}
                />
              ) : null}
              {booking.priceDelivery > 0 ? (
                <Row
                  label={t("booking.priceDelivery")}
                  value={formatMoney(
                    booking.priceDelivery,
                    booking.currency,
                    "en",
                  )}
                />
              ) : null}
              <Row
                label={t("booking.priceTotal")}
                value={formatMoney(booking.priceTotal, booking.currency, "en")}
                strong
              />
            </dl>

            {payments.length === 0 ? (
              <p className="text-muted-2 pt-3 text-sm">
                {t("booking.noPayments")}
              </p>
            ) : (
              <ul className="divide-border mt-3 divide-y">
                {payments.map((payment) => (
                  <li key={payment.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink font-semibold">
                        {payment.provider} · {payment.status}
                      </span>
                      <span className="text-ink font-bold tabular-nums">
                        {formatMoney(payment.amount, payment.currency, "en")}
                      </span>
                    </div>
                    {payment.providerRef ? (
                      <p className="text-muted-2 pt-0.5 font-mono text-xs break-all">
                        {payment.providerRef}
                      </p>
                    ) : null}
                    {payment.refundRequired ? (
                      <p className="rounded-input mt-1.5 bg-[#fdeceb] px-2.5 py-1.5 text-xs font-semibold text-[#b3261e]">
                        {t("booking.refundRequired")}
                        {payment.refundReason
                          ? ` · ${payment.refundReason}`
                          : ""}
                      </p>
                    ) : null}
                    {/* The provider's own dashboard is where a refund actually
                        happens — phase 6 deliberately does not automate that. */}
                    {payment.provider === "skipcash" ? (
                      <a
                        href="https://skipcash.app/merchant/transactions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-strong text-xs font-bold"
                      >
                        {t("booking.providerPortal")} →
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DispatchPanel
            reference={booking.reference}
            dispatches={dispatches}
            recipients={drivers}
            photos={photos}
            previewEn={previewEn}
            previewAr={previewAr}
          />

          <NotificationsPanel entries={notifications} />
          <NotesPanel reference={booking.reference} notes={notes} />

          <section className="border-border bg-surface rounded-card border p-4">
            <h2 className="text-ink-deep text-sm font-bold">
              {t("booking.timeline")}
            </h2>
            <ol className="mt-3 flex flex-col gap-3">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="bg-accent mt-1.5 size-2 shrink-0 rounded-full"
                  />
                  <div className="min-w-0">
                    <p className="text-ink font-semibold">
                      {event.fromStatus
                        ? `${event.fromStatus} → ${event.toStatus}`
                        : event.toStatus}
                    </p>
                    <p className="text-muted-2 text-xs">
                      {event.actorType}
                      {event.actorId ? ` · ${event.actorId}` : ""} ·{" "}
                      {new Date(event.createdAt).toLocaleString("en-GB", {
                        timeZone: "Asia/Qatar",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    {typeof event.metadata.reason === "string" ? (
                      <p className="text-muted text-xs">
                        {event.metadata.reason}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-2 shrink-0">{label}</dt>
      <dd
        className={
          strong
            ? "text-ink font-bold tabular-nums"
            : mono
              ? "text-ink font-semibold tabular-nums"
              : "text-ink min-w-0 text-end"
        }
      >
        {value}
      </dd>
    </div>
  );
}

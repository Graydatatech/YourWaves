import "server-only";

import { createTranslator } from "next-intl";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import {
  formatFullDate,
  formatMoney,
  formatTime,
  type Locale,
} from "@/lib/booking/format";
import { isIsoDate, normaliseTime } from "@/lib/dates";
import type { NotificationPayload, NotificationLocale } from "../types";
import { directionFor, type EmailDirection } from "./components";

/**
 * Everything a template is allowed to read.
 *
 * Built once per notification, so a template is a pure function of this object.
 * That is what makes the /dev/emails preview trustworthy: it constructs the
 * same context from sample data, through the same code, so what it renders is
 * what a real booking would produce.
 */

const CATALOGUES = { ar, en } as const;

/**
 * The worker has no request context, so next-intl's `getTranslations()` is
 * unavailable. `createTranslator` takes the catalogue explicitly and is the
 * supported way to translate outside a request — same messages, same typed
 * keys, no React and no async local storage.
 */
export function notificationTranslator(locale: NotificationLocale) {
  return createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: "notifications",
  });
}

export type TemplateContext = {
  locale: NotificationLocale;
  dir: EmailDirection;
  t: ReturnType<typeof notificationTranslator>;
  payload: NotificationPayload;

  /** Pre-formatted, because every template needs the same strings. */
  reference: string;
  dateLong: string;
  startTime: string;
  /** 90 minutes before the customer's start — what the driver is held to. */
  arrivalTime: string;
  addressFull: string;
  total: string;
  customerName: string;
  customerPhone: string;
  driverName: string;

  /** Universal link: opens the native Maps app on both iOS and Android. */
  mapsLink: string;
  /** wa.me deep link to the business number. */
  whatsappLink: string;
  supportPhone: string;
  /** Absolute link into the admin dashboard (phase 8 owns the route). */
  adminLink: string;
  siteUrl: string;
};

/** The public site origin, used for every absolute link an email contains. */
export function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://yourwaves.qa"
  );
}

/** The business WhatsApp number shown to customers. */
export function supportPhone(): string {
  return process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "+974 5006 7667";
}

/**
 * A maps link that opens the native app.
 *
 * Order matters. Coordinates are exact and are what a driver actually needs, so
 * they win when present. `maps.google.com/?q=lat,lng` and the `?api=1` search
 * URL are both claimed by the Android and iOS Google Maps apps via their
 * universal-link filters, so this opens the app rather than a browser tab when
 * it is installed, and degrades to the web map when it is not.
 *
 * A customer-supplied `maps_url` is used only as a fallback: it is often a
 * shortened share link that resolves to a place page rather than a pin, which
 * is worse for navigation than a raw coordinate.
 */
export function buildMapsLink(payload: NotificationPayload): string {
  const lat = payload.lat !== undefined ? Number(payload.lat) : undefined;
  const lng = payload.lng !== undefined ? Number(payload.lng) : undefined;

  if (
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  if (payload.maps_url) return payload.maps_url;

  const query = [payload.address_line, payload.area, payload.city, "Qatar"]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * How long before the customer's slot the crew is expected on site.
 *
 * 180, not 90. The customer-facing copy no longer promises "about ninety
 * minutes" — it says the crew arrives several hours early — and this is the
 * figure the DRIVER is held to on the job sheet. Leaving it at 90 would mean
 * telling the customer one thing and the crew another about the same morning.
 *
 * Three hours is the plain reading of "several hours". It is one number in one
 * place (mirrored in dispatch/service.ts) if the real policy is different.
 */
export const CREW_LEAD_MINUTES = 180;

/**
 * Subtracts the crew lead time from the start, on the clock face.
 *
 * Deliberately plain minute arithmetic rather than a Date: this is a wall-clock
 * time in Qatar with no date attached, and routing it through a Date would
 * reintroduce exactly the timezone bug §4b exists to prevent. A slot early
 * enough to underflow midnight clamps to 00:00 — the booking day starts at
 * 08:00, so it cannot happen with real settings, and a negative time would be
 * worse than a clamped one.
 */
export function arrivalClockTime(start: string): string {
  const [hour, minute] = start.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return start;
  const total = hour * 60 + minute - CREW_LEAD_MINUTES;
  const clamped = Math.max(total, 0);
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}:00`;
}

export function buildContext(
  payload: NotificationPayload,
  locale: NotificationLocale,
): TemplateContext {
  const t = notificationTranslator(locale);
  const intlLocale = locale as Locale;
  const currency = payload.currency ?? "QAR";

  // Every field is defensive. A payload is written by SQL and read here
  // possibly after a retry, a deploy or a schema change; a template that throws
  // has already consumed an attempt and tells the customer nothing.
  const date = payload.booking_date;
  const dateLong =
    date && isIsoDate(date) ? formatFullDate(date, intlLocale) : (date ?? "");

  let startTime = "";
  let arrivalTime = "";
  if (payload.preferred_start) {
    try {
      const normalised = normaliseTime(payload.preferred_start);
      startTime = formatTime(normalised, intlLocale);
      arrivalTime = formatTime(arrivalClockTime(normalised), intlLocale);
    } catch {
      startTime = payload.preferred_start;
    }
  }

  const addressFull = [payload.address_line, payload.area, payload.city]
    .filter(Boolean)
    .join(", ");

  const phone = supportPhone();

  return {
    locale,
    dir: directionFor(locale),
    t,
    payload,
    reference: payload.reference ?? "",
    dateLong,
    startTime,
    arrivalTime,
    addressFull,
    total:
      payload.price_total !== undefined
        ? formatMoney(payload.price_total, currency, intlLocale)
        : "",
    customerName: payload.customer_name ?? "",
    customerPhone: payload.customer_phone ?? "",
    driverName: payload.driver_name ?? "",
    mapsLink: buildMapsLink(payload),
    whatsappLink: `https://wa.me/${phone.replace(/\D/g, "")}`,
    supportPhone: phone,
    adminLink: `${siteOrigin()}/admin/bookings/${payload.reference ?? ""}`,
    siteUrl: siteOrigin(),
  };
}

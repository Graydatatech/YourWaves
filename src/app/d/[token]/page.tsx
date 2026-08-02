import { headers } from "next/headers";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import {
  clientIp,
  resolveDispatchToken,
  type DispatchJob,
} from "@/lib/dispatch/service";
import { formatFullDate, formatMoney, formatTime } from "@/lib/booking/format";
import { qatarToday } from "@/lib/dates";
import { JobActions } from "./JobActions";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

/**
 * The delivery job sheet. Public, no login — the token is the authorisation.
 *
 * Designed for one specific moment: a driver, one-handed, in a car, in Qatari
 * sunlight, on 4G. So: black on white at large sizes rather than the marketing
 * site's soft palette, the two things they need first (when and where) above
 * everything else, and every action a full-width target.
 *
 * Bilingual, defaulting to the recipient's language, toggled with `?lang=`
 * rather than client state — a server-rendered toggle has no flash and survives
 * a reload in a flaky tunnel.
 */

const CATALOGUES = { ar, en } as const;

export default async function DispatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang } = await searchParams;
  const requestHeaders = await headers();

  const result = await resolveDispatchToken(token, {
    ip: clientIp(requestHeaders),
    userAgent: requestHeaders.get("user-agent"),
  });

  // Every refusal renders the SAME neutral page and reveals nothing about
  // whether the token ever existed. Only "expired" is named, because that one
  // tells a legitimate recipient something useful and gives away nothing.
  if (!result.ok) {
    const locale = lang === "ar" ? "ar" : "en";
    const t = createTranslator({
      locale,
      messages: CATALOGUES[locale],
      namespace: "jobSheet",
    });

    const [title, body] =
      result.reason === "expired" || result.reason === "revoked"
        ? [t("expiredTitle"), t("expiredBody")]
        : result.reason === "rate_limited"
          ? [t("busyTitle"), t("busyBody")]
          : [t("invalidTitle"), t("invalidBody")];

    return (
      <main
        lang={locale}
        dir={locale === "ar" ? "rtl" : "ltr"}
        className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"
      >
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <p className="pt-3 text-lg text-[#425a6b]">{body}</p>
      </main>
    );
  }

  const job = result.job;
  const locale = lang === "ar" || lang === "en" ? lang : job.locale;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const t = createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: "jobSheet",
  });

  const today = qatarToday();
  const isToday = job.bookingDate === today;

  const mapsHref = buildNavLink(job);
  const available = availableActions(job.status);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ jobSheet: CATALOGUES[locale].jobSheet }}
      timeZone="Asia/Qatar"
    >
      <main
        lang={locale}
        dir={dir}
        className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-4 pb-12"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold tracking-[0.14em] text-[#097182] uppercase">
              {t("reference")}
            </p>
            {/* The reference is quoted on the phone to the office, so it is
                isolated LTR — Arabic would otherwise reorder its parts. */}
            <p dir="ltr" className="text-2xl font-extrabold tabular-nums">
              {job.reference}
            </p>
          </div>
          <a
            href={`?lang=${locale === "ar" ? "en" : "ar"}`}
            className="min-h-11 rounded-full border border-[#dde7ee] px-4 pt-2.5 text-sm font-bold"
          >
            {t("language")}
          </a>
        </header>

        {/* WHEN. The single most important fact on the page — a driver who
            reads nothing else must still arrive at the right time. */}
        <section
          className={cn(
            "rounded-2xl px-4 py-5",
            isToday ? "bg-[#04141f] text-white" : "bg-[#f1f5f9]",
          )}
        >
          {isToday ? (
            <p className="text-sm font-extrabold tracking-[0.18em] text-[#7ff2ea]">
              {t("today")}
            </p>
          ) : null}
          <p className={cn("text-lg font-bold", !isToday && "text-[#425a6b]")}>
            {formatFullDate(job.bookingDate, locale)}
          </p>
          <p className="pt-2 text-sm font-bold tracking-[0.12em] uppercase opacity-80">
            {t("arriveBy")}
          </p>
          {/* `auto`, not `ltr`. formatTime pins Latin DIGITS but leaves the
              meridiem in the locale's own script, so the Arabic string is
              "8:00 ص" — its first strong character is Arabic and the run is
              therefore RTL. Forcing it LTR moved the ص to the end, which is
              the same class of bug as the "km/h 45" hero described in
              CLAUDE.md §4. This is the largest number on the page and the one
              a driver reads at a glance. */}
          <p
            dir="auto"
            className="text-[44px] leading-none font-extrabold tabular-nums"
          >
            {formatTime(job.arrivalTime, locale)}
          </p>
          <p className="pt-2 text-sm opacity-80">
            {/* Isolated because it sits INSIDE a sentence: without it the colon
                is a neutral character between an Arabic label and a
                digit-leading time, and the bidi algorithm is free to move it. */}
            {t("startTime")}:{" "}
            <span dir="auto" className="inline-block [unicode-bidi:isolate]">
              {formatTime(job.preferredStart, locale)}
            </span>
          </p>
        </section>

        {/* WHERE. Navigate is the primary action of the whole page. */}
        <section className="flex flex-col gap-2">
          <p className="text-sm font-bold tracking-[0.12em] text-[#425a6b] uppercase">
            {t("address")}
          </p>
          <p className="text-xl leading-snug font-bold">{job.addressLine}</p>
          {job.area || job.city ? (
            <p className="text-lg text-[#425a6b]">
              {[job.area, job.city].filter(Boolean).join(", ")}
            </p>
          ) : null}

          <a
            href={mapsHref}
            className="mt-1 flex min-h-16 items-center justify-center rounded-2xl bg-[#04141f] px-5 text-xl font-extrabold text-white"
          >
            {t("navigate")}
          </a>

          {/* The customer's own dropped pin, when they gave one. Kept separate
              from Navigate: a share link often resolves to a place page rather
              than a pin, which is worse to drive to. */}
          {job.mapsUrl ? (
            <a
              href={job.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center justify-center rounded-2xl border border-[#dde7ee] px-5 text-base font-bold"
            >
              {t("customerPin")}
            </a>
          ) : null}
        </section>

        {/* WHO. Both contact routes, full width. */}
        <section className="flex flex-col gap-2">
          <p className="text-sm font-bold tracking-[0.12em] text-[#425a6b] uppercase">
            {t("customer")}
          </p>
          <p className="text-xl font-bold">{job.customerName}</p>
          <div className="flex gap-2">
            <a
              href={`tel:${job.customerPhone.replace(/\s/g, "")}`}
              className="flex min-h-14 flex-1 items-center justify-center rounded-2xl bg-[#097182] px-4 text-lg font-extrabold text-white"
            >
              {t("call")}
            </a>
            <a
              href={`https://wa.me/${job.customerPhone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 flex-1 items-center justify-center rounded-2xl bg-[#25D366] px-4 text-lg font-extrabold text-white"
            >
              {t("whatsapp")}
            </a>
          </div>
        </section>

        {/* MONEY. Unmissable when something is owed. */}
        <section
          className={cn(
            "rounded-2xl px-4 py-4",
            job.isPaid
              ? "bg-[#ecfdf5] text-[#065f46]"
              : "bg-[#fdeceb] text-[#b3261e]",
          )}
        >
          <p className="text-sm font-bold tracking-[0.12em] uppercase">
            {t("payment")}
          </p>
          <p className="text-xl font-extrabold">
            {job.isPaid ? t("paid") : t("collect")}
          </p>
          {/* Same reason as the arrival time: formatMoney renders the currency
              as "ر.ق." in Arabic, so the run resolves RTL from its own content.
              This is the figure a driver may be collecting in cash. */}
          <p dir="auto" className="text-lg font-bold tabular-nums">
            {formatMoney(job.priceTotal, job.currency, locale)}
          </p>
        </section>

        {job.notes ? (
          <section className="rounded-2xl bg-[#fff7ed] px-4 py-4">
            <p className="text-sm font-bold tracking-[0.12em] text-[#92400e] uppercase">
              {t("siteNotes")}
            </p>
            <p className="pt-1 text-lg leading-snug font-semibold text-[#92400e]">
              {job.notes}
            </p>
          </section>
        ) : null}

        <section className="rounded-2xl border border-[#dde7ee] px-4 py-4">
          <p className="text-sm font-bold tracking-[0.12em] text-[#425a6b] uppercase">
            {t("equipment")}
          </p>
          <p className="pt-1 text-base leading-snug">{t("equipmentBody")}</p>
        </section>

        <section className="flex flex-col gap-2 pt-2">
          <p className="text-sm font-bold tracking-[0.12em] text-[#425a6b] uppercase">
            {t("statusTitle")}
          </p>
          <JobActions
            token={token}
            status={job.status}
            available={available}
          />
        </section>
      </main>
    </NextIntlClientProvider>
  );
}

/**
 * A link that opens the native maps app.
 *
 * The `?api=1` Google Maps search URL is claimed by the Maps app's
 * universal-link filters on both iOS and Android, so it opens the app when
 * installed and the web map when not. A raw `geo:` URI opens the app more
 * reliably on Android but does nothing on iOS, so this is the form that works
 * on both — and it is the same link phase 7 sends, so what the driver taps in
 * WhatsApp and what they tap here go to the same pin.
 */
function buildNavLink(job: DispatchJob): string {
  const lat = job.lat !== null ? Number(job.lat) : undefined;
  const lng = job.lng !== null ? Number(job.lng) : undefined;

  if (
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  const query = [job.addressLine, job.area, job.city, "Qatar"]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Which buttons make sense at this point in the job. */
function availableActions(
  status: string,
): Array<"on_my_way" | "setup_complete" | "job_complete"> {
  switch (status) {
    case "confirmed":
    case "assigned":
      return ["on_my_way"];
    case "en_route":
      return ["setup_complete", "job_complete"];
    default:
      return [];
  }
}

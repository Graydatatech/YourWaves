"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/booking/format";
import type { AdminSettings, DriverRow, FaqItem } from "@/lib/admin/types";
import type { ServiceArea } from "@/lib/booking/serviceArea";
import { cn } from "@/lib/cn";
import { ConfirmSheet } from "../../components/ConfirmSheet";

/**
 * Settings.
 *
 * MONEY IS ENTERED IN MAJOR UNITS AND STORED IN MINOR ONES. The field says
 * "4500" because that is what the operator thinks the price is; 450000 goes to
 * the server. Doing that conversion at the edge — here and in the API schema —
 * is what keeps §4b's "integers in minor units, never floats" true everywhere
 * behind it.
 *
 * Multi-value fields (start times, areas, admin emails) are textareas, one per
 * line, rather than tag widgets. It is a settings page an ops person opens
 * twice a year; a line-per-item is obvious, pasteable and needs no explanation.
 */
const FIELD = cn(
  "border-border bg-surface rounded-input min-h-11 w-full border px-3",
  // 16px minimum: a smaller input makes iOS Safari zoom the viewport on focus.
  "text-base outline-none focus:border-accent",
);

export function SettingsForm({
  settings,
  drivers,
}: {
  settings: AdminSettings;
  drivers: DriverRow[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [form, setForm] = useState({
    /**
     * ONE price. Migration 0012 folded setup and delivery into the day rate
     * because that is how the day is sold; the columns still exist and are
     * written as zero, so an older booking's breakdown still reads back.
     */
    priceRental: String(settings.priceRental / 100),
    availableStartTimes: settings.availableStartTimes.join("\n"),
    leadTimeHours: String(settings.leadTimeHours),
    maxAdvanceDays: String(settings.maxAdvanceDays),
    holdMinutes: String(settings.holdMinutes),
    adminNotificationEmails: settings.adminNotificationEmails.join("\n"),
    termsEn: settings.termsEn,
    termsAr: settings.termsAr,
    // Footer overrides. Empty means "use the designed default", which is why
    // every one of these seeds from `?? ""` rather than from the rendered copy:
    // showing the default IN the box would turn "leave it alone" into "pin it
    // to today's wording".
    footerTaglineEn: settings.footer.taglineEn ?? "",
    footerTaglineAr: settings.footer.taglineAr ?? "",
    footerEmail: settings.footer.email ?? "",
    footerPhone: settings.footer.phone ?? "",
    footerCitiesEn: settings.footer.citiesEn ?? "",
    footerCitiesAr: settings.footer.citiesAr ?? "",
    footerInstagram: settings.footer.instagram ?? "",
    footerWhatsapp: settings.footer.whatsapp ?? "",
    footerYoutube: settings.footer.youtube ?? "",
  });

  /**
   * Areas are a list of PAIRS, so a textarea will not do — two textareas whose
   * lines have to stay aligned is a trap, and one line of "English = Arabic"
   * makes the separator part of the data.
   */
  const [areas, setAreas] = useState<ServiceArea[]>(settings.serviceAreas);

  /**
   * FAQ rows. Separate state from `form` for the same reason `areas` is: this
   * is a list of records, and a textarea of lines cannot express four fields
   * per row without inventing a separator that becomes part of the data.
   */
  const [faq, setFaq] = useState<FaqItem[]>(settings.faq);

  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  // Major → minor units. Rounded, not truncated: "45.005" must not silently
  // become 4500 dirhams instead of 4501.
  const toMinor = (value: string) => Math.round(Number(value) * 100);

  const total = toMinor(form.priceRental);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        priceRental: toMinor(form.priceRental),
        // Sent explicitly rather than left alone: the whole price lives in the
        // day rate now, and a stale non-zero here would be added to it.
        priceSetup: 0,
        priceDelivery: 0,
        availableStartTimes: lines(form.availableStartTimes),
        leadTimeHours: Number(form.leadTimeHours),
        maxAdvanceDays: Number(form.maxAdvanceDays),
        holdMinutes: Number(form.holdMinutes),
        serviceAreas: areas
          .map((area) => ({ en: area.en.trim(), ar: area.ar.trim() }))
          .filter((area) => area.en !== ""),
        adminNotificationEmails: lines(form.adminNotificationEmails),
        // Sent verbatim — NOT split into lines. Blank lines are the paragraph
        // separator the public page renders from, so collapsing them would
        // silently reflow somebody's terms into one block.
        termsEn: form.termsEn,
        termsAr: form.termsAr,
        faq,
        footer: {
          taglineEn: form.footerTaglineEn,
          taglineAr: form.footerTaglineAr,
          email: form.footerEmail,
          phone: form.footerPhone,
          citiesEn: form.footerCitiesEn,
          citiesAr: form.footerCitiesAr,
          instagram: form.footerInstagram,
          whatsapp: form.footerWhatsapp,
          youtube: form.footerYoutube,
        },
      }),
    });

    setPending(false);

    if (!response.ok) {
      setError(t("common.error"));
      return;
    }

    setSaved(true);
    router.refresh();
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setForm((previous) => ({ ...previous, [key]: event.target.value })),
    };
  }

  /**
   * Everything `field()` gives a number input, plus the wheel guard.
   *
   * A FOCUSED `<input type="number">` captures the mouse wheel and steps its
   * value once per notch. This form is longer than the viewport, so the normal
   * way to save is: type the price, scroll down, click Save — and every notch of
   * that scroll silently took a riyal off. The audit trail caught it: a day rate
   * typed as 4000 was stored as 3999, and 7000 as 6996.
   *
   * Blurring on wheel is the fix rather than preventDefault, because
   * preventDefault on a passive listener does nothing and would still let the
   * page under it scroll oddly. Losing focus stops the stepping and leaves the
   * page scrolling normally. Arrow keys still step the value, which is what a
   * deliberate keystroke should do.
   */
  function numberField(key: keyof typeof form) {
    return {
      ...field(key),
      onWheel: (event: React.WheelEvent<HTMLInputElement>) =>
        event.currentTarget.blur(),
    };
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.pricing")}
        </h2>
        <p className="text-muted-2 pt-1 text-xs">{t("settings.pricingHint")}</p>

        <div className="wide:grid-cols-3 grid gap-3 pt-3">
          <Labelled label={t("settings.rental")}>
            <input
              type="number"
              min={0}
              step="1"
              className={FIELD}
              {...numberField("priceRental")}
            />
          </Labelled>
        </div>

        <p className="text-ink pt-3 text-sm font-bold">
          {t("settings.total")}:{" "}
          <span className="tabular-nums">
            {formatMoney(
              Number.isFinite(total) ? total : 0,
              settings.currency,
              "en",
            )}
          </span>
        </p>
      </section>

      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.availability")}
        </h2>

        <div className="wide:grid-cols-3 grid gap-3 pt-3">
          <Labelled
            label={t("settings.leadTime")}
            hint={t("settings.leadTimeHint")}
          >
            <input
              type="number"
              min={0}
              className={FIELD}
              {...numberField("leadTimeHours")}
            />
          </Labelled>
          <Labelled label={t("settings.maxAdvance")}>
            <input
              type="number"
              min={1}
              className={FIELD}
              {...numberField("maxAdvanceDays")}
            />
          </Labelled>
          <Labelled label={t("settings.holdMinutes")}>
            <input
              type="number"
              min={1}
              className={FIELD}
              {...numberField("holdMinutes")}
            />
          </Labelled>
        </div>

        <div className="pt-3">
          <Labelled
            label={t("settings.startTimes")}
            hint={t("settings.startTimesHint")}
          >
            <textarea
              rows={5}
              className={cn(FIELD, "py-2")}
              {...field("availableStartTimes")}
            />
          </Labelled>
        </div>
      </section>

      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.areas")}
        </h2>
        <p className="text-muted-2 pt-1 text-xs">{t("settings.areasHint")}</p>

        <ul className="flex flex-col gap-2 pt-3">
          {areas.map((area, index) => (
            <li key={index} className="flex items-end gap-2">
              <label className="flex-1">
                <span className="text-muted-2 text-xs font-semibold">
                  {t("settings.areaEn")}
                </span>
                <input
                  className={cn(FIELD, "mt-1")}
                  value={area.en}
                  onChange={(event) =>
                    setAreas((previous) =>
                      previous.map((row, i) =>
                        i === index ? { ...row, en: event.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="flex-1">
                <span className="text-muted-2 text-xs font-semibold">
                  {t("settings.areaAr")}
                </span>
                {/* dir="rtl" so Arabic is typed and read the right way round
                    inside an otherwise English screen. */}
                <input
                  dir="rtl"
                  lang="ar"
                  className={cn(FIELD, "mt-1")}
                  value={area.ar}
                  onChange={(event) =>
                    setAreas((previous) =>
                      previous.map((row, i) =>
                        i === index ? { ...row, ar: event.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                aria-label={t("settings.areaRemove")}
                onClick={() =>
                  setAreas((previous) => previous.filter((_, i) => i !== index))
                }
                className="tap-target text-muted shrink-0 px-2 text-lg font-bold hover:text-[#b3261e]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setAreas((previous) => [...previous, { en: "", ar: "" }])
          }
          className="border-border text-ink rounded-pill mt-3 min-h-11 border px-5 text-sm font-bold"
        >
          {t("settings.areaAdd")}
        </button>
      </section>

      <section className="border-border bg-surface rounded-card border p-4">
        <Labelled
          label={t("settings.adminEmails")}
          hint={t("settings.adminEmailsHint")}
        >
          <textarea
            rows={4}
            className={cn(FIELD, "py-2")}
            {...field("adminNotificationEmails")}
          />
        </Labelled>
      </section>

      {/* FAQ ---------------------------------------------------------------
          Deleting every row restores the designed questions, like the footer
          and the terms — an empty section reads as broken, not as intentional. */}
      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">{t("settings.faq")}</h2>
        <p className="text-muted-2 pt-1 text-sm">{t("settings.faqHint")}</p>

        <ul className="flex flex-col gap-3 pt-3">
          {faq.map((item, index) => (
            <li key={index} className="border-border rounded-input border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-2 text-xs font-bold">
                  {t("settings.faqRow", { number: index + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("settings.faqMoveUp")}
                    disabled={index === 0}
                    onClick={() =>
                      setFaq((previous) => {
                        const next = [...previous];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                    className="tap-target text-muted-2 hover:text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={t("settings.faqMoveDown")}
                    disabled={index === faq.length - 1}
                    onClick={() =>
                      setFaq((previous) => {
                        const next = [...previous];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        return next;
                      })
                    }
                    className="tap-target text-muted-2 hover:text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFaq((previous) =>
                        previous.filter((_, i) => i !== index),
                      )
                    }
                    className="tap-target text-danger text-sm font-bold"
                  >
                    {t("settings.faqRemove")}
                  </button>
                </div>
              </div>

              {(
                [
                  ["questionEn", "faqQuestionEn", "ltr", 1],
                  ["questionAr", "faqQuestionAr", "rtl", 1],
                  ["answerEn", "faqAnswerEn", "ltr", 3],
                  ["answerAr", "faqAnswerAr", "rtl", 3],
                ] as const
              ).map(([key, label, dir, rows]) => (
                <label key={key} className="mt-2 block">
                  <span className="text-muted-2 text-xs font-semibold">
                    {t(`settings.${label}`)}
                  </span>
                  <textarea
                    rows={rows}
                    dir={dir}
                    className={cn(FIELD, "mt-1 py-2 text-sm")}
                    value={item[key]}
                    onChange={(event) =>
                      setFaq((previous) =>
                        previous.map((row, i) =>
                          i === index
                            ? { ...row, [key]: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setFaq((previous) => [
              ...previous,
              { questionEn: "", questionAr: "", answerEn: "", answerAr: "" },
            ])
          }
          className="border-border text-ink rounded-pill mt-3 min-h-11 border px-5 text-sm font-bold"
        >
          {t("settings.faqAdd")}
        </button>
      </section>

      {/* Footer ------------------------------------------------------------
          Every box is optional. Empty means the designed copy from
          messages/*.json is used, so clearing a field RESTORES the default
          rather than blanking the line — which is what the placeholder text on
          each input says. */}
      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.footer")}
        </h2>
        <p className="text-muted-2 pt-1 text-sm">{t("settings.footerHint")}</p>

        <div className="mt-3 flex flex-col gap-3">
          <Labelled label={t("settings.footerTaglineEn")}>
            <textarea
              rows={2}
              dir="ltr"
              className={cn(FIELD, "py-2")}
              placeholder={t("settings.footerDefault")}
              {...field("footerTaglineEn")}
            />
          </Labelled>
          <Labelled label={t("settings.footerTaglineAr")}>
            <textarea
              rows={2}
              dir="rtl"
              className={cn(FIELD, "py-2")}
              placeholder={t("settings.footerDefault")}
              {...field("footerTaglineAr")}
            />
          </Labelled>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label={t("settings.footerEmail")}>
              <input
                type="email"
                dir="ltr"
                className={FIELD}
                placeholder={t("settings.footerDefault")}
                {...field("footerEmail")}
              />
            </Labelled>
            <Labelled label={t("settings.footerPhone")}>
              <input
                type="tel"
                dir="ltr"
                className={FIELD}
                placeholder={t("settings.footerDefault")}
                {...field("footerPhone")}
              />
            </Labelled>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label={t("settings.footerCitiesEn")}>
              <input
                dir="ltr"
                className={FIELD}
                placeholder={t("settings.footerDefault")}
                {...field("footerCitiesEn")}
              />
            </Labelled>
            <Labelled label={t("settings.footerCitiesAr")}>
              <input
                dir="rtl"
                className={FIELD}
                placeholder={t("settings.footerDefault")}
                {...field("footerCitiesAr")}
              />
            </Labelled>
          </div>

          <p className="text-muted-2 pt-1 text-sm">
            {t("settings.footerSocialHint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labelled label={t("settings.footerInstagram")}>
              <input
                dir="ltr"
                className={FIELD}
                placeholder="instagram.com/yourwaves"
                {...field("footerInstagram")}
              />
            </Labelled>
            <Labelled label={t("settings.footerWhatsapp")}>
              <input
                dir="ltr"
                className={FIELD}
                placeholder="wa.me/97450067667"
                {...field("footerWhatsapp")}
              />
            </Labelled>
            <Labelled label={t("settings.footerYoutube")}>
              <input
                dir="ltr"
                className={FIELD}
                placeholder="youtube.com/@yourwaves"
                {...field("footerYoutube")}
              />
            </Labelled>
          </div>
        </div>
      </section>

      {/* Terms & conditions ---------------------------------------------- */}
      <section className="border-border bg-surface rounded-card border p-4">
        <h2 className="text-ink-deep text-sm font-bold">
          {t("settings.terms")}
        </h2>
        <p className="text-muted-2 pt-1 text-sm">{t("settings.termsHint")}</p>

        <div className="mt-3 flex flex-col gap-3">
          <Labelled label={t("settings.termsEn")}>
            <textarea
              rows={10}
              dir="ltr"
              className={cn(FIELD, "py-2 font-mono text-sm")}
              {...field("termsEn")}
            />
          </Labelled>
          <Labelled
            label={t("settings.termsAr")}
            hint={t("settings.termsArHint")}
          >
            <textarea
              rows={10}
              dir="rtl"
              className={cn(FIELD, "py-2 text-sm")}
              {...field("termsAr")}
            />
          </Labelled>
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-input bg-[#fdeceb] px-3.5 py-2.5 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          role="status"
          className="rounded-input bg-[#ecfdf5] px-3.5 py-2.5 text-sm text-[#065f46]"
        >
          {t("common.saved")}
        </p>
      ) : null}

      {/* Sticky above the bottom tab bar: the form is long, and hunting for a
          save button at the end of it on a phone is miserable. */}
      <div
        className={cn(
          "bg-page/95 sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-10",
          "wide:static wide:mx-0 wide:px-0 -mx-4 px-4 py-2 backdrop-blur-sm",
        )}
      >
        <button
          type="submit"
          disabled={pending}
          className="bg-accent rounded-pill wide:w-auto min-h-12 w-full px-6 text-base font-bold text-white disabled:opacity-60"
        >
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>

      <DriversPanel drivers={drivers} />
    </form>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink text-sm font-semibold">{label}</span>
      {hint ? <span className="text-muted-2 text-xs">{hint}</span> : null}
      {children}
    </label>
  );
}

/**
 * Driver CRUD.
 *
 * Nested inside the settings <form> would make its buttons submit that form, so
 * every control here is type="button" and posts on its own.
 */
function DriversPanel({ drivers }: { drivers: DriverRow[] }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DriverRow["role"]>("driver");
  const [isDefault, setIsDefault] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DriverRow | null>(null);

  async function addDriver() {
    if (!fullName.trim() || !phone.trim()) return;
    setPending(true);
    setError(null);

    const response = await fetch("/api/admin/recipients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName, phone, email, role, isDefault }),
    });

    setPending(false);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        detail.error === "duplicate_phone"
          ? t("settings.driverDuplicate")
          : detail.error === "invalid_phone"
            ? t("settings.driverPhoneInvalid")
            : detail.error === "invalid_body"
              ? t("settings.driverEmailInvalid")
              : t("common.error"),
      );
      return;
    }

    setFullName("");
    setPhone("");
    setEmail("");
    router.refresh();
  }

  async function removeDriver(driver: DriverRow) {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/admin/recipients/${driver.id}`, {
      method: "DELETE",
    });

    setPending(false);
    setConfirmDelete(null);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
        bookings?: number;
      };
      setError(
        detail.error === "has_bookings"
          ? t("settings.driverDeleteHasJobs", { count: detail.bookings ?? 0 })
          : t("common.error"),
      );
      return;
    }

    router.refresh();
  }

  /**
   * Auto-dispatch: is this person messaged the moment a booking is paid?
   *
   * The one setting that decides who hears about a job without anybody doing
   * anything, so it is a single tap on the row rather than buried in an edit
   * form.
   */
  async function toggleDefault(driver: DriverRow) {
    setError(null);
    const response = await fetch(`/api/admin/recipients/${driver.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDefault: !driver.isDefault }),
    });
    if (!response.ok) {
      setError(t("common.error"));
      return;
    }
    router.refresh();
  }

  async function toggleActive(driver: DriverRow) {
    setError(null);
    const response = await fetch(`/api/admin/recipients/${driver.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !driver.isActive }),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        detail.error === "has_active_jobs"
          ? t("settings.driverHasJobs")
          : t("common.error"),
      );
      return;
    }
    router.refresh();
  }

  return (
    <section
      id="drivers"
      className="border-border bg-surface rounded-card scroll-mt-4 border p-4"
    >
      <h2 className="text-ink-deep text-sm font-bold">
        {t("settings.drivers")}
      </h2>

      <ul className="divide-border mt-3 divide-y">
        {drivers.map((driver) => (
          <li
            key={driver.id}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-ink truncate text-sm font-semibold">
                {driver.fullName}
              </p>
              <p className="text-muted-2 truncate text-xs">
                <span className="tabular-nums">{driver.phone}</span>
                {" · "}
                {t(
                  `settings.role${driver.role.charAt(0).toUpperCase()}${driver.role.slice(1)}` as "settings.roleDriver",
                )}
                {driver.activeJobs > 0
                  ? ` · ${t("settings.driverJobs", { count: driver.activeJobs })}`
                  : ""}
              </p>
              {/* The address, or a warning that there is none. A recipient
                  added before 0020 still falls back to WhatsApp, which nothing
                  has ever delivered — so "no email" is the one thing about a
                  row that needs to be visible without opening anything. */}
              <p
                className={cn(
                  "truncate text-xs",
                  driver.email ? "text-muted-2" : "text-danger font-semibold",
                )}
                dir="ltr"
              >
                {driver.email ?? t("settings.driverEmailMissing")}
              </p>
              <button
                type="button"
                onClick={() => toggleDefault(driver)}
                className={cn(
                  "rounded-pill mt-1 min-h-11 border px-2.5 text-xs font-bold",
                  driver.isDefault
                    // Same pair as the `confirmed` status pill; kept in step
                    // with it, and on the post-phase-10 accent (5.14:1, was
                    // 4.55:1 on the old #0a7a8c).
                    ? "border-[#b8e3ef] bg-[#e8f6fb] text-[#097182]"
                    : "border-border text-muted-2",
                )}
              >
                {driver.isDefault
                  ? t("settings.isDefaultOn")
                  : t("settings.isDefaultOff")}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => toggleActive(driver)}
                className={cn(
                  "rounded-pill min-h-11 border px-3 text-xs font-bold",
                  driver.isActive
                    ? "border-border text-muted"
                    : "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]",
                )}
              >
                {driver.isActive
                  ? t("settings.deactivate")
                  : t("settings.activate")}
              </button>

              {/* Delete is offered ONLY for a driver who has never been
                  dispatched — the typo case. Anyone with history would have
                  their name blanked on every booking they ran, so for them the
                  answer is deactivate, and the title says so. */}
              {driver.totalJobs === 0 ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(driver)}
                  className="rounded-pill min-h-11 border border-[#f5c2be] px-3 text-xs font-bold text-[#b3261e]"
                >
                  {t("settings.driverDelete")}
                </button>
              ) : (
                <span
                  title={t("settings.driverKeepHistory")}
                  className="text-muted-2 px-1 text-xs tabular-nums"
                >
                  {driver.totalJobs}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Name, number, email, role and whether they are on auto-dispatch.
          The number is still the IDENTITY (0009's unique index, and what a
          dispatcher rings), but since 0020 the job sheet itself goes to the
          email — so both are required. `is_default` decides who hears about a
          job the moment it is paid for. */}
      <p className="text-muted-2 mt-3 text-xs">{t("settings.driverHint")}</p>

      <div className="border-border wide:grid-cols-2 mt-2 grid gap-2 border-t pt-3">
        <input
          className={FIELD}
          placeholder={t("settings.driverName")}
          aria-label={t("settings.driverName")}
          autoComplete="off"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />

        {/* The dial code is shown rather than silently prepended, so what is
            typed and what is stored are visibly the same number. */}
        <div
          className={cn(
            "border-border bg-surface rounded-input flex min-h-11 items-center",
            "focus-within:border-accent overflow-hidden border",
          )}
        >
          <span className="text-muted-2 border-border border-e px-3 text-base font-semibold tabular-nums">
            +974
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent px-3 text-base tabular-nums outline-none"
            placeholder={t("settings.driverPhone")}
            aria-label={t("settings.driverPhone")}
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) =>
              // Digits only; the country code is fixed by the prefix. A pasted
              // "+974 5501 0001" therefore still lands as 55010001.
              setPhone(
                event.target.value.replace(/\D/g, "").replace(/^974/, ""),
              )
            }
          />
        </div>

        {/* Where the job sheet goes. Spans both columns at the wide
            breakpoint: an address is longer than a name or a number and
            truncating it mid-domain makes a typo impossible to spot. */}
        <input
          className={cn(FIELD, "wide:col-span-2")}
          type="email"
          inputMode="email"
          dir="ltr"
          placeholder={t("settings.driverEmail")}
          aria-label={t("settings.driverEmail")}
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="wide:grid-cols-2 mt-2 grid gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-2 text-xs font-semibold">
            {t("settings.driverRole")}
          </span>
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as DriverRow["role"])
            }
            className={FIELD}
          >
            <option value="driver">{t("settings.roleDriver")}</option>
            <option value="owner">{t("settings.roleOwner")}</option>
            <option value="supervisor">{t("settings.roleSupervisor")}</option>
            <option value="other">{t("settings.roleOther")}</option>
          </select>
        </label>

        <label className="text-muted flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
            className="size-4"
          />
          {t("settings.makeDefault")}
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-input mt-2 bg-[#fdeceb] px-3 py-2 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={addDriver}
        disabled={pending || !fullName.trim() || !phone.trim()}
        className="border-border text-ink rounded-pill mt-3 min-h-11 border px-5 text-sm font-bold disabled:opacity-50"
      >
        {t("settings.addDriver")}
      </button>

      <ConfirmSheet
        open={confirmDelete !== null}
        pending={pending}
        tone="danger"
        title={t("settings.driverDeleteTitle", {
          name: confirmDelete?.fullName ?? "",
        })}
        body={t("settings.driverDeleteBody")}
        confirmLabel={t("settings.driverDelete")}
        onConfirm={() => confirmDelete && removeDriver(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}

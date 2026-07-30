"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DriverRow } from "@/lib/admin/types";
import { cn } from "@/lib/cn";

/**
 * Who has been told about this job, whether they looked, and what they did.
 *
 * The three states that matter are visible without opening anything: sent,
 * opened, and revoked. "Sent but never opened" an hour before arrival time is
 * the thing an ops person needs to notice, so it is the one styled as a
 * warning.
 */

export type DispatchEntry = {
  id: string;
  fullName: string;
  phone: string;
  sentAt: string | null;
  openedAt: string | null;
  revokedAt: string | null;
  isExpired: boolean;
  opens: number;
  actions: Array<{ action: string; outcome: string; createdAt: string }>;
};

export type DispatchPhoto = {
  id: string;
  dispatchId: string;
  createdAt: string;
};

export function DispatchPanel({
  reference,
  dispatches,
  recipients,
  photos,
  previewEn,
  previewAr,
}: {
  reference: string;
  dispatches: DispatchEntry[];
  recipients: DriverRow[];
  photos: DispatchPhoto[];
  previewEn: string;
  previewAr: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [save, setSave] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const photosFor = (dispatchId: string) =>
    photos.filter((photo) => photo.dispatchId === dispatchId);

  const alreadyDispatched = new Set(dispatches.map((entry) => entry.phone));
  const available = recipients.filter(
    (recipient) =>
      recipient.isActive && !alreadyDispatched.has(recipient.phone),
  );

  async function send(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/admin/bookings/${reference}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    setPending(false);

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        detail.error === "invalid_phone"
          ? t("settings.driverPhoneInvalid")
          : t("common.error"),
      );
      return false;
    }

    router.refresh();
    return true;
  }

  async function resend(entry: DispatchEntry) {
    // rotate: a resend must mint a NEW token, or the "lost" message still works
    // and revocation means nothing.
    const ok = await send({
      fullName: entry.fullName,
      phone: entry.phone,
      rotate: true,
    });
    if (ok) setMessage(t("booking.dispatchResent"));
  }

  async function revoke(entry: DispatchEntry) {
    setPending(true);
    await fetch(`/api/admin/dispatch/${entry.id}`, { method: "DELETE" });
    setPending(false);
    router.refresh();
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <h2 className="text-ink-deep text-sm font-bold">
        {t("booking.dispatchTitle")}
      </h2>
      <p className="text-muted-2 pt-1 text-xs">{t("booking.dispatchHint")}</p>

      {dispatches.length === 0 ? (
        <p className="text-muted pt-3 text-sm">{t("booking.dispatchNone")}</p>
      ) : (
        <ul className="divide-border mt-2 divide-y">
          {dispatches.map((entry) => {
            const dead = Boolean(entry.revokedAt) || entry.isExpired;
            return (
              <li key={entry.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-semibold">
                      {entry.fullName}
                    </p>
                    <p className="text-muted-2 truncate text-xs tabular-nums">
                      {entry.phone}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "rounded-pill shrink-0 border px-2 py-0.5 text-xs font-semibold",
                      dead
                        ? "border-[#cbd5e1] bg-[#f1f5f9] text-[#64748b]"
                        : entry.openedAt
                          ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
                          : "border-[#fcd9a4] bg-[#fff7ed] text-[#92400e]",
                    )}
                  >
                    {entry.revokedAt
                      ? t("booking.dispatchRevoked")
                      : entry.isExpired
                        ? t("booking.dispatchExpired")
                        : entry.openedAt
                          ? t("booking.dispatchOpened")
                          : t("booking.dispatchNotOpened")}
                  </span>
                </div>

                {entry.actions.length > 0 ? (
                  <p className="text-muted-2 pt-1 text-xs">
                    {entry.actions
                      .filter((action) => action.outcome === "applied")
                      .map((action) => action.action)
                      .join(" → ")}
                  </p>
                ) : null}

                {/* Completion photos from THIS recipient. Thumbnails rather
                    than a list of links: the question an ops person is asking
                    is "does that look finished?", which a filename cannot
                    answer. Full size opens in a new tab. */}
                {photosFor(entry.id).length > 0 ? (
                  <ul className="flex flex-wrap gap-2 pt-2">
                    {photosFor(entry.id).map((photo) => (
                      <li key={photo.id}>
                        <a
                          href={`/api/admin/photos/${photo.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element --
                              an authenticated, no-store byte stream; next/image
                              would try to proxy and cache it. */}
                          <img
                            src={`/api/admin/photos/${photo.id}`}
                            alt={t("booking.dispatchPhotoAlt")}
                            className="border-border size-16 rounded-lg border object-cover"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex items-center gap-3 pt-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => resend(entry)}
                    className="text-accent-strong min-h-11 text-xs font-bold disabled:opacity-50"
                  >
                    {t("booking.dispatchResend")}
                  </button>
                  {!dead ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => revoke(entry)}
                      className="min-h-11 text-xs font-bold text-[#b3261e] disabled:opacity-50"
                    >
                      {t("booking.dispatchRevoke")}
                    </button>
                  ) : null}
                  {entry.opens > 0 ? (
                    <span className="text-muted-2 text-xs tabular-nums">
                      {t("booking.dispatchOpens", { count: entry.opens })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {message ? (
        <p
          role="status"
          className="rounded-input mt-3 bg-[#ecfdf5] px-3 py-2 text-sm text-[#065f46]"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-input mt-3 bg-[#fdeceb] px-3 py-2 text-sm text-[#b3261e]"
        >
          {error}
        </p>
      ) : null}

      {adding ? (
        <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
          {available.length > 0 ? (
            <label className="flex flex-col gap-1">
              <span className="text-muted-2 text-xs font-semibold">
                {t("booking.dispatchPick")}
              </span>
              <select
                value={recipientId}
                onChange={(event) => setRecipientId(event.target.value)}
                className="border-border bg-surface rounded-input focus:border-accent min-h-11 border px-3 text-base outline-none"
              >
                <option value="">—</option>
                {available.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.fullName} · {recipient.phone}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!recipientId ? (
            <>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder={t("booking.dispatchNewName")}
                aria-label={t("booking.dispatchNewName")}
                className="border-border bg-surface rounded-input focus:border-accent min-h-11 border px-3 text-base outline-none"
              />
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t("booking.dispatchNewPhone")}
                aria-label={t("booking.dispatchNewPhone")}
                inputMode="tel"
                className="border-border bg-surface rounded-input focus:border-accent min-h-11 border px-3 text-base tabular-nums outline-none"
              />
              <label className="text-muted flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={save}
                  onChange={(event) => setSave(event.target.checked)}
                  className="size-4"
                />
                {t("booking.dispatchSave")}
              </label>
            </>
          ) : null}

          <button
            type="button"
            disabled={
              pending || (!recipientId && (!fullName.trim() || !phone.trim()))
            }
            onClick={async () => {
              const ok = await send(
                recipientId ? { recipientId } : { fullName, phone, save },
              );
              if (ok) {
                setAdding(false);
                setRecipientId("");
                setFullName("");
                setPhone("");
                setSave(false);
              }
            }}
            className="bg-accent rounded-pill min-h-11 px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {t("booking.dispatchSend")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border-border text-ink rounded-pill mt-3 min-h-11 border px-5 text-sm font-bold"
        >
          {t("booking.dispatchAdd")}
        </button>
      )}

      {/* Exactly what the recipient will receive, in both languages. An ops
          person should never have to send a message to find out what it says. */}
      <details className="mt-3">
        <summary className="text-muted-2 tap-target cursor-pointer text-xs font-semibold">
          {t("booking.dispatchPreview")}
        </summary>
        <pre className="bg-page text-ink mt-2 rounded-xl p-3 text-xs whitespace-pre-wrap">
          {previewEn}
        </pre>
        <pre
          dir="rtl"
          className="bg-page text-ink mt-2 rounded-xl p-3 text-xs whitespace-pre-wrap"
        >
          {previewAr}
        </pre>
      </details>
    </section>
  );
}

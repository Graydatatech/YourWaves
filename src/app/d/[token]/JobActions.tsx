"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  readOnline,
  readPhotoQueue,
  readQueue,
  serverOnline,
  serverPhotoQueue,
  serverQueue,
  subscribeOnline,
  subscribeQueue,
  writePhotoQueue,
  writeQueue,
  type QueuedAction,
  type QueuedPhoto,
} from "./queue";
import { compressPhoto, type CompressedPhoto } from "./compress";

/**
 * The three buttons, and the offline queue behind them.
 *
 * A driver taps "On my way" in an underground car park or on the edge of
 * coverage in Al Wakrah. Losing that tap is not acceptable — the customer is
 * waiting on the message it triggers — so a failed post is written to
 * localStorage and replayed when the connection returns.
 *
 * Every queued item carries a `clientActionId` generated once, at tap time, and
 * reused on every retry. That is what makes the replay safe: the server keys
 * idempotency off it, so a queue flushed twice applies once.
 */

type Action = QueuedAction["action"];

export function JobActions({
  token,
  status,
  available,
}: {
  token: string;
  status: string;
  available: Action[];
}) {
  const t = useTranslations("jobSheet");
  const router = useRouter();

  const [confirming, setConfirming] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [justDone, setJustDone] = useState<Action | null>(null);
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // Read straight from the external sources rather than copying them into state
  // in an effect — see ./queue.ts for why that distinction matters here.
  const queue = useSyncExternalStore(
    subscribeQueue,
    () => readQueue(token),
    serverQueue,
  );
  const photoQueue = useSyncExternalStore(
    subscribeQueue,
    () => readPhotoQueue(token),
    serverPhotoQueue,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    readOnline,
    serverOnline,
  );

  /** Posts one action. Returns true when the server has it. */
  const post = useCallback(
    async (item: QueuedAction): Promise<boolean> => {
      try {
        const response = await fetch(`/api/dispatch/${token}/status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: item.action,
            clientActionId: item.clientActionId,
          }),
        });

        if (response.ok) {
          /**
           * The new status comes from the SERVER on the next render, not from
           * local state. `router.refresh()` re-runs the page, which also
           * recomputes which buttons should now be showing — and it keeps this
           * function free of setState, so the reconnect effect below does not
           * trip react-hooks/set-state-in-effect. Offline it is a no-op, which
           * is correct: nothing has changed server-side yet.
           */
          router.refresh();
          return true;
        }

        // 4xx other than 429 will fail identically forever — a dead token, an
        // illegal move. Dropping it is right: retrying cannot help, and a queue
        // that never empties shows a permanent "not synced" badge.
        if (response.status !== 429 && response.status < 500) return true;
        return false;
      } catch {
        // Network down. Keep it.
        return false;
      }
    },
    [token, router],
  );

  /**
   * Uploads one photo. Same shape as `post`, same drop-on-4xx rule — a photo
   * the server has already got, or has refused as too large, must not sit in
   * the queue showing "not synced" forever.
   */
  const postPhoto = useCallback(
    async (item: QueuedPhoto): Promise<boolean> => {
      try {
        const response = await fetch(`/api/dispatch/${token}/photo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientActionId: item.clientActionId,
            mimeType: item.mimeType,
            data: item.data,
          }),
        });

        if (response.ok) return true;
        if (response.status !== 429 && response.status < 500) return true;
        return false;
      } catch {
        return false;
      }
    },
    [token],
  );

  const flush = useCallback(async () => {
    // Status updates first, always. If the connection dies halfway through a
    // flush, the thing that got through should be the one the customer is
    // waiting on, not the photo.
    const current = readQueue(token);
    if (current.length > 0) {
      const remaining: QueuedAction[] = [];
      for (const item of current) {
        const done = await post(item);
        if (!done) remaining.push(item);
      }
      // The store notifies its subscribers; there is no setState to call.
      writeQueue(token, remaining);
    }

    const photos = readPhotoQueue(token);
    if (photos.length > 0) {
      const remaining: QueuedPhoto[] = [];
      for (const item of photos) {
        const done = await postPhoto(item);
        if (!done) remaining.push(item);
      }
      writePhotoQueue(token, remaining);
    }
  }, [post, postPhoto, token]);

  // Replay on reconnect, and once on mount in case the tab was closed while
  // offline and reopened with coverage.
  // The ONLY effect: replay the queue when the connection comes back, and once
  // on mount in case the tab was closed offline and reopened with coverage.
  // It sets no state directly — `flush` writes to the store, which notifies.
  useEffect(() => {
    function handleOnline() {
      void flush();
    }

    window.addEventListener("online", handleOnline);
    if (navigator.onLine) void flush();

    return () => window.removeEventListener("online", handleOnline);
  }, [flush]);

  async function run(action: Action) {
    setPending(true);
    setConfirming(null);

    const item: QueuedAction = {
      // One id per TAP, reused by every retry of that tap.
      clientActionId:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action,
      queuedAt: Date.now(),
    };

    const sent = await post(item);

    if (!sent) {
      writeQueue(token, [...readQueue(token), item]);
    }

    // The photo rides the SAME clientActionId as the tap it documents, which is
    // what makes a replay store it once, and what lets the office see which
    // action the picture belongs to. It is posted after the status and never
    // instead of it.
    if (photo && action === "job_complete") {
      const upload: QueuedPhoto = {
        clientActionId: item.clientActionId,
        mimeType: photo.mimeType,
        data: photo.data,
        queuedAt: Date.now(),
      };

      const uploaded = await postPhoto(upload);
      if (!uploaded) {
        writePhotoQueue(token, [...readPhotoQueue(token), upload]);
      }

      URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
    }

    setJustDone(action);
    setPending(false);
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;

    setPreparing(true);
    setPhotoError(null);

    const result = await compressPhoto(file);

    if (!result.ok) {
      setPhotoError(
        result.reason === "too_large" ? t("photoTooBig") : t("photoUnreadable"),
      );
      setPreparing(false);
      return;
    }

    // Replacing a picked photo: the old preview URL is leaked otherwise, and a
    // driver retaking a shot three times is the normal case.
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(result.photo);
    setPreparing(false);
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    setPhotoError(null);
  }

  const LABEL: Record<Action, string> = {
    on_my_way: t("actionOnMyWay"),
    setup_complete: t("actionSetupComplete"),
    job_complete: t("actionJobComplete"),
  };

  const CONFIRM: Record<Action, string> = {
    on_my_way: t("confirmOnMyWay"),
    setup_complete: t("confirmSetup"),
    job_complete: t("confirmComplete"),
  };

  if (status === "completed") {
    return (
      <p className="rounded-2xl bg-[#ecfdf5] px-4 py-5 text-center text-lg font-bold text-[#065f46]">
        {t("statusDone")}
      </p>
    );
  }

  if (status === "cancelled") {
    return (
      <p className="rounded-2xl bg-[#fdeceb] px-4 py-5 text-center text-lg font-bold text-[#b3261e]">
        {t("statusCancelled")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(!online || queue.length + photoQueue.length > 0) && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-2xl px-4 py-3",
            "bg-[#fff7ed] text-[15px] font-bold text-[#92400e]",
          )}
        >
          <span>
            {!online
              ? t("offline")
              : t("unsynced", { count: queue.length + photoQueue.length })}
          </span>
          {queue.length + photoQueue.length > 0 && online ? (
            <button
              type="button"
              onClick={() => void flush()}
              className="min-h-11 shrink-0 rounded-full bg-[#92400e] px-4 text-sm font-bold text-white"
            >
              {t("retryNow")}
            </button>
          ) : null}
        </div>
      )}

      {available.map((action) => {
        const isDone = justDone === action;
        return (
          <button
            key={action}
            type="button"
            disabled={pending}
            onClick={() => setConfirming(action)}
            className={cn(
              // 64px tall, 20px type: this is pressed with a thumb, outdoors,
              // possibly with wet hands.
              "min-h-16 rounded-2xl px-5 text-xl font-extrabold",
              "transition-colors disabled:opacity-60",
              isDone
                ? "bg-[#ecfdf5] text-[#065f46]"
                : "bg-[#0a7a8c] text-white",
            )}
          >
            {pending && confirming === action
              ? t("sending")
              : isDone
                ? `${LABEL[action]} ✓`
                : LABEL[action]}
          </button>
        );
      })}

      {/* A plain overlay rather than <dialog>: this must work identically in
          the WhatsApp in-app browser, where showModal support is inconsistent. */}
      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConfirming(null);
          }}
        >
          <div className="w-full rounded-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
            <h2 className="text-xl font-extrabold">{CONFIRM[confirming]}</h2>
            <p className="pt-2 text-base text-[#4a6577]">{t("confirmBody")}</p>

            {/* The optional photo of the finished setup. Only on the last step:
                a picture of a wave that is not built yet proves nothing, and an
                extra control on every button is an extra thing to get wrong
                while standing in the sun. */}
            {confirming === "job_complete" ? (
              <div className="flex flex-col gap-2 pt-4">
                {photo ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element --
                        a blob: URL from the camera, with no width known ahead of
                        time; next/image cannot optimise what it cannot fetch. */}
                    <img
                      src={photo.previewUrl}
                      alt=""
                      className="size-20 rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="min-h-11 text-base font-bold text-[#b3261e]"
                    >
                      {t("photoRemove")}
                    </button>
                  </div>
                ) : null}

                <label
                  className={cn(
                    "flex min-h-14 items-center justify-center rounded-2xl",
                    "border border-dashed border-[#94a3b8] px-4 text-base font-bold",
                  )}
                >
                  {/* `capture` opens the camera directly on a phone, which is
                      what is wanted here — but it stays a normal file input, so
                      a photo already taken can still be picked. */}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => {
                      void choosePhoto(event.target.files?.[0]);
                      // Allow re-picking the same file after a failure.
                      event.target.value = "";
                    }}
                  />
                  {preparing
                    ? t("photoPreparing")
                    : photo
                      ? t("photoRetake")
                      : t("photoAdd")}
                </label>

                {photoError ? (
                  <p
                    role="alert"
                    className="text-base font-bold text-[#b3261e]"
                  >
                    {photoError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-2 pt-5">
              <button
                type="button"
                disabled={preparing}
                onClick={() => void run(confirming)}
                className="min-h-14 rounded-2xl bg-[#0a7a8c] px-5 text-lg font-extrabold text-white disabled:opacity-60"
              >
                {t("confirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="min-h-14 rounded-2xl border border-[#dde7ee] px-5 text-lg font-bold"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

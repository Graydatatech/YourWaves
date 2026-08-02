"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { GalleryImage } from "@/lib/admin/types";
import { compressImage } from "./compressImage";

const FIELD = cn(
  "border-border bg-surface rounded-input min-h-11 w-full border px-3",
  "text-base outline-none focus:border-accent",
);

/**
 * Gallery images.
 *
 * ITS OWN PANEL AND ITS OWN SAVE, not part of the big settings form. Uploading
 * a file is a different kind of action from typing a price: it has a progress
 * state, it can fail on its own, and burying it inside a form whose Save button
 * also changes the day rate would mean an admin adding a photo and accidentally
 * committing a half-edited price.
 *
 * Order here is order on the page, and the tile shapes are fixed by the design
 * — the first image gets the tall 3/4 tile, the second the wide 4/3, and so on.
 * That is what preserves the masonry and the CLS guarantee, so reordering is
 * how you decide which photo gets which shape.
 */
export function GalleryPanel({ images }: { images: GalleryImage[] }) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [rows, setRows] = useState<GalleryImage[]>(images);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function publicUrl(path: string): string {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
      /\/+$/,
      "",
    );
    return `${base}/storage/v1/object/public/gallery/${path}`;
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const compressed = await compressImage(file);
      if (!compressed.ok) {
        setError(t(`gallery.errors.${compressed.reason}`));
        return;
      }
      // The preview blob is only needed if we rendered it; the row renders from
      // the public URL once saved, so release it immediately.
      URL.revokeObjectURL(compressed.previewUrl);

      const body = new FormData();
      body.set("file", compressed.file);

      const response = await fetch("/api/admin/gallery", {
        method: "POST",
        body,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        setError(t("gallery.errors.uploadFailed"));
        return;
      }

      // Appended, not saved. The image reaches the site only when Save is
      // pressed — so an upload that goes wrong leaves an unused object in the
      // bucket rather than a broken tile on the home page.
      setRows((previous) => [
        ...previous,
        { path: json.path as string, altEn: "", altAr: "" },
      ]);
    } catch {
      setError(t("gallery.errors.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gallery: rows }),
      });
      if (!response.ok) {
        setError(t("gallery.errors.saveFailed"));
        return;
      }

      /**
       * Delete the bytes only AFTER the settings row no longer references them.
       * The other order would leave the page pointing at objects that are gone,
       * and an unreferenced object costs a few kilobytes where a broken tile
       * costs the look of the page.
       */
      const removed = images.filter(
        (original) => !rows.some((row) => row.path === original.path),
      );
      await Promise.all(
        removed.map((image) =>
          fetch(
            `/api/admin/gallery?path=${encodeURIComponent(image.path)}`,
            { method: "DELETE" },
          ).catch(() => undefined),
        ),
      );

      setSaved(true);
      router.refresh();
    } catch {
      setError(t("gallery.errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    setRows((previous) => {
      const next = [...previous];
      const target = index + delta;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <h2 className="text-ink-deep text-sm font-bold">{t("gallery.title")}</h2>
      <p className="text-muted-2 pt-1 text-sm">{t("gallery.hint")}</p>

      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row, index) => (
          <li
            key={row.path}
            className="border-border rounded-input flex gap-3 border p-3"
          >
            {/* A plain <img>: this is the back office, the file is a few
                hundred KB, and next/image here would add an optimiser round
                trip for a thumbnail only an admin ever sees. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={publicUrl(row.path)}
              alt=""
              className="size-20 shrink-0 rounded-lg object-cover"
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-2 text-xs font-bold">
                  {t("gallery.position", { number: index + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("gallery.moveUp")}
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                    className="tap-target text-muted-2 hover:text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={t("gallery.moveDown")}
                    disabled={index === rows.length - 1 || busy}
                    onClick={() => move(index, 1)}
                    className="tap-target text-muted-2 hover:text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setRows((previous) =>
                        previous.filter((_, i) => i !== index),
                      )
                    }
                    className="tap-target text-danger text-sm font-bold"
                  >
                    {t("gallery.remove")}
                  </button>
                </div>
              </div>

              <label className="mt-1 block">
                <span className="text-muted-2 text-xs font-semibold">
                  {t("gallery.altEn")}
                </span>
                <input
                  dir="ltr"
                  className={cn(FIELD, "mt-1 text-sm")}
                  value={row.altEn}
                  onChange={(event) =>
                    setRows((previous) =>
                      previous.map((item, i) =>
                        i === index
                          ? { ...item, altEn: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="mt-2 block">
                <span className="text-muted-2 text-xs font-semibold">
                  {t("gallery.altAr")}
                </span>
                <input
                  dir="rtl"
                  className={cn(FIELD, "mt-1 text-sm")}
                  value={row.altAr}
                  onChange={(event) =>
                    setRows((previous) =>
                      previous.map((item, i) =>
                        i === index
                          ? { ...item, altAr: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label
          className={cn(
            "rounded-pill border-border text-ink inline-flex min-h-11 cursor-pointer",
            "items-center border px-5 text-sm font-bold",
            busy && "pointer-events-none opacity-45",
          )}
        >
          {t("gallery.add")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file twice still fires a change.
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={cn(
            "rounded-pill min-h-11 px-5 text-sm font-bold",
            "bg-[#097182] text-white disabled:opacity-45",
          )}
        >
          {busy ? t("common.saving") : t("common.save")}
        </button>

        {saved && (
          <span role="status" className="text-sm font-semibold text-[#065f46]">
            {t("common.saved")}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-danger pt-2 text-sm font-semibold">
          {error}
        </p>
      )}
    </section>
  );
}

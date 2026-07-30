"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BookingNoteRow } from "@/lib/admin/types";
import { cn } from "@/lib/cn";

/**
 * Internal notes — timestamped and attributed, and deliberately separate from
 * the audit timeline below it.
 *
 * `booking_events` is what the SYSTEM did and is append-only by trigger; these
 * are what a PERSON wrote, and can be deleted. Mixing them would mean either a
 * note that cannot be removed, or an audit trail with a hole in it.
 */
export function NotesPanel({
  reference,
  notes,
}: {
  reference: string;
  notes: BookingNoteRow[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() || pending) return;

    setPending(true);
    await fetch(`/api/admin/bookings/${reference}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setPending(false);
    setBody("");
    router.refresh();
  }

  async function removeNote(id: string) {
    await fetch(`/api/admin/notes/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="border-border bg-surface rounded-card border p-4">
      <h2 className="text-ink-deep text-sm font-bold">{t("booking.notes")}</h2>

      <form onSubmit={addNote} className="flex flex-col gap-2 pt-3">
        <label htmlFor="note" className="sr-only">
          {t("booking.notesPlaceholder")}
        </label>
        <textarea
          id="note"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("booking.notesPlaceholder")}
          className={cn(
            "border-border bg-surface rounded-input border px-3 py-2.5",
            "focus:border-accent resize-y text-base outline-none",
          )}
        />
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="bg-accent rounded-pill min-h-11 self-start px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? t("common.saving") : t("booking.addNote")}
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="text-muted-2 pt-3 text-sm">{t("booking.noNotes")}</p>
      ) : (
        <ul className="divide-border mt-3 divide-y">
          {notes.map((note) => (
            <li key={note.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink text-xs font-bold">
                  {note.authorName}
                </span>
                <span className="text-muted-2 shrink-0 text-xs tabular-nums">
                  {new Date(note.createdAt).toLocaleString("en-GB", {
                    timeZone: "Asia/Qatar",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p className="text-ink pt-1 text-sm whitespace-pre-wrap">
                {note.body}
              </p>
              <button
                type="button"
                onClick={() => removeNote(note.id)}
                className="text-muted-2 pt-1 text-xs font-semibold hover:text-[#b3261e]"
              >
                {t("booking.deleteNote")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

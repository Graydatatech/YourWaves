import "server-only";

import { sql } from "@/db/client";
import type { Locale } from "@/i18n/routing";

/**
 * Terms & conditions, as the customer sees them.
 *
 * PLAIN TEXT, NEVER HTML. An admin types into a textarea and this splits the
 * result on blank lines into paragraphs. That is the whole rendering model, and
 * it is deliberate: accepting markup would let anyone with back-office access
 * put a <script> on a public page, and the back office is not a place where
 * that should be possible even for people you trust.
 *
 * Arabic falls back to English rather than to nothing. A business that has
 * written its terms once and not yet translated them is better served showing
 * the English than showing an Arabic customer a blank page where the terms of
 * their booking should be.
 */

export type Terms = {
  /** Paragraphs, in reading order. Empty when nothing has been written. */
  paragraphs: string[];
  /** True when the text shown is the English fallback on an Arabic page. */
  isFallback: boolean;
};

/** Blank-line-separated paragraphs, with stray whitespace collapsed away. */
function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export async function getTerms(locale: Locale): Promise<Terms> {
  const rows = await sql<{ terms_en: string | null; terms_ar: string | null }[]>`
    SELECT terms_en, terms_ar FROM settings WHERE id = 1
  `;

  const en = (rows[0]?.terms_en ?? "").trim();
  const ar = (rows[0]?.terms_ar ?? "").trim();

  const preferred = locale === "ar" ? ar : en;
  const chosen = preferred || en;

  return {
    paragraphs: toParagraphs(chosen),
    isFallback: locale === "ar" && !ar && en.length > 0,
  };
}

/**
 * Whether there is anything to agree TO.
 *
 * The booking form asks this before rendering the agreement tick, because a
 * checkbox linking to an empty page is worse than no checkbox: it makes the
 * customer accept terms that do not exist, which is both meaningless and the
 * kind of thing that reads badly if it is ever looked at.
 *
 * Cheap enough to call on the settings route — it reads one row that is already
 * being read there.
 */
export async function hasTerms(): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT (COALESCE(btrim(terms_en), '') <> '') AS present
      FROM settings WHERE id = 1
  `;
  return rows[0]?.present ?? false;
}

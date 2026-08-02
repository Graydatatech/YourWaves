import "server-only";

import { sql } from "@/db/client";
import type { Locale } from "@/i18n/routing";

/**
 * FAQ content, with the designed questions as the floor.
 *
 * ONE SOURCE FOR TWO CONSUMERS. The accordion on the page and the FAQPage
 * JSON-LD both read this, so the structured data cannot describe questions the
 * page does not show — which is the sort of mismatch that earns a manual
 * action rather than a ranking.
 *
 * An empty column falls back to `messages/*.json`, so an untouched deployment
 * renders the five designed questions and an admin who deletes every row gets
 * them back rather than an empty section.
 */

export type FaqEntry = { question: string; answer: string };

type StoredItem = {
  questionEn?: unknown;
  questionAr?: unknown;
  answerEn?: unknown;
  answerAr?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Arabic falls back to English per FIELD, not per item.
 *
 * A row translated by somebody who did the questions and not yet the answers
 * should show an Arabic question with the English answer — incomplete, but
 * readable. Falling back per item instead would show the English question too,
 * throwing away work that was done.
 */
function localise(item: StoredItem, locale: Locale): FaqEntry | null {
  const questionEn = text(item.questionEn);
  const answerEn = text(item.answerEn);
  const questionAr = text(item.questionAr);
  const answerAr = text(item.answerAr);

  const question = locale === "ar" ? questionAr || questionEn : questionEn;
  const answer = locale === "ar" ? answerAr || answerEn : answerEn;

  // A question with no answer is worse than no question: the reader taps it
  // and gets nothing. Drop the row rather than render half of it.
  if (!question || !answer) return null;
  return { question, answer };
}

export async function getFaq(
  locale: Locale,
  fallback: FaqEntry[],
): Promise<FaqEntry[]> {
  let stored: unknown = [];

  try {
    const rows = await sql<{ faq: unknown }[]>`
      SELECT faq FROM settings WHERE id = 1
    `;
    stored = rows[0]?.faq ?? [];
  } catch {
    // A database that has not run migration 0016, or a brief outage, must not
    // take the FAQ off the page. The designed questions are a fine answer.
    return fallback;
  }

  if (!Array.isArray(stored) || stored.length === 0) return fallback;

  const items = stored
    .map((item) => localise(item as StoredItem, locale))
    .filter((item): item is FaqEntry => item !== null);

  // Every stored row unusable — all blank, or a shape we do not recognise —
  // is indistinguishable from "not configured" to a reader.
  return items.length > 0 ? items : fallback;
}

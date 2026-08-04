import "server-only";

import { createHash } from "node:crypto";
import { sql } from "@/db/client";

/**
 * Post-activity surveys.
 *
 * The link in the email IS the authorisation, so the token is treated as a
 * credential rather than an identifier — the same model as the dispatch job
 * sheet (§4i), and for a weaker but real version of the same reason: the page
 * shows the customer their own booking reference and date.
 *
 *   - 32 bytes of pgcrypto randomness, URL-safe, stored ONLY as a sha256 hash
 *   - looked up by indexed equality on every open
 *   - scoped to ONE booking; there is no endpoint that lists anything
 *   - every refusal looks identical from outside
 */

/** Same digest the SQL side produces, byte for byte. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type ReviewInvite = {
  id: string;
  reference: string;
  bookingDate: string;
  customerName: string;
  authorName: string;
  authorArea: string | null;
  locale: "ar" | "en";
  /** Already answered — the page says thank you instead of asking again. */
  submitted: boolean;
  rating: number | null;
  comment: string | null;
};

export type ResolveResult =
  | { ok: true; invite: ReviewInvite }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Resolves a survey link.
 *
 * `not_found` covers a token that never existed, one that has been deleted with
 * its booking, and a tampered string — all answered identically, because
 * distinguishing them would confirm which tokens exist. `expired` is named,
 * because that tells a legitimate customer something useful and an attacker
 * nothing.
 */
export async function resolveReviewToken(
  token: string,
): Promise<ResolveResult> {
  if (!token || token.length < 20) return { ok: false, reason: "not_found" };

  const rows = await sql<
    {
      id: string;
      reference: string;
      booking_date: string;
      customer_name: string;
      author_name: string | null;
      author_area: string | null;
      locale: string;
      submitted_at: string | null;
      rating: number | null;
      comment: string | null;
      expired: boolean;
    }[]
  >`
    SELECT r.id,
           b.reference,
           to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
           b.customer_name,
           r.author_name, r.author_area, r.locale,
           r.submitted_at, r.rating, r.comment,
           (r.expires_at <= now()) AS expired
      FROM reviews r
      JOIN bookings b ON b.id = r.booking_id
     WHERE r.token_hash = ${hashToken(token)}
  `;

  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.expired) return { ok: false, reason: "expired" };

  return {
    ok: true,
    invite: {
      id: row.id,
      reference: row.reference,
      bookingDate: row.booking_date,
      customerName: row.customer_name,
      authorName: row.author_name ?? row.customer_name,
      authorArea: row.author_area,
      locale: row.locale === "en" ? "en" : "ar",
      submitted: row.submitted_at !== null,
      rating: row.rating,
      comment: row.comment,
    },
  };
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "invalid" };

/**
 * Records a customer's answer.
 *
 * EDITABLE UNTIL THE LINK EXPIRES, not write-once. Somebody who submits a
 * rating and then thinks of what they wanted to say should be able to add it,
 * and there is no cost to us — publication is a separate, moderated act.
 *
 * Publishing is deliberately NOT reset on an edit. An admin who has approved a
 * comment has approved that text; silently republishing whatever replaces it
 * would make the moderation gate meaningless. An edited-after-publication
 * review is unpublished instead, so it has to be looked at again.
 */
export async function submitReview(
  token: string,
  input: { rating: number; comment: string; authorName: string },
): Promise<SubmitResult> {
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, reason: "invalid" };
  }

  const comment = input.comment.trim().slice(0, 2000);
  const authorName = input.authorName.trim().slice(0, 120);

  const rows = await sql<{ id: string }[]>`
    UPDATE reviews
       SET rating       = ${rating},
           comment      = ${comment === "" ? null : comment},
           author_name  = ${authorName === "" ? null : authorName},
           submitted_at = now(),
           -- Any edit returns it to the moderation queue.
           is_published = false,
           published_at = NULL
     WHERE token_hash = ${hashToken(token)}
       AND expires_at > now()
    RETURNING id
  `;

  if (rows.length === 0) {
    // Either no such token or it has lapsed. The page has already told the
    // customer which; this is the race between the two.
    return { ok: false, reason: "not_found" };
  }

  return { ok: true };
}

/*
 * There is no enqueueDueSurveys() any more.
 *
 * Until 0019 the notifications cron swept for bookings whose date was
 * yesterday and mailed a survey for each. Two things were wrong with that:
 * `booking_date` is when the wave was BOOKED for, not evidence it happened —
 * a job the crew could not get the trailer in for still had a date, and still
 * got "how was the wave?" the next morning — and the extra day bought nothing,
 * because the office marking a booking `completed` IS the crew having packed
 * up.
 *
 * The token is now minted by enqueue_completion_with_survey() from the status
 * trigger, and the link travels in the completion email. Everything else in
 * this file — resolving /r/<token>, recording an answer, moderation — is
 * unchanged and still the whole of the customer-facing survey.
 */

export type PublishedReview = {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  authorArea: string | null;
};

/**
 * Published reviews for the marketing page.
 *
 * Only rows an admin has explicitly published, and only those with something to
 * quote — a five-star rating with no words is a number, not a testimonial.
 */
export async function getPublishedReviews(
  limit = 6,
): Promise<PublishedReview[]> {
  try {
    const rows = await sql<
      {
        id: string;
        rating: number;
        comment: string;
        author_name: string | null;
        author_area: string | null;
      }[]
    >`
      SELECT id, rating, comment, author_name, author_area
        FROM reviews
       WHERE is_published
         AND comment IS NOT NULL
         AND btrim(comment) <> ''
       ORDER BY published_at DESC
       LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      authorName: row.author_name ?? "",
      authorArea: row.author_area,
    }));
  } catch {
    // No migration 0018 yet, or a brief outage. The testimonials section falls
    // back to the designed copy rather than the page failing.
    return [];
  }
}

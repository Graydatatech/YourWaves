import { z } from "zod";
import { submitReview } from "@/lib/reviews/service";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).default(""),
  /**
   * REQUIRED, not defaulted.
   *
   * A published quote with no name attached is the thing a reader discounts
   * fastest — and the form now asks for it as a required field, so accepting a
   * blank one here would mean the UI and the endpoint disagreed about what a
   * complete answer is. `trim().min(1)` rather than `min(1)`: a space is not a
   * name, and it would render as an empty line under the quote.
   */
  authorName: z.string().trim().min(1).max(120),
});

/**
 * POST /api/reviews/[token] — record a customer's answer.
 *
 * The token in the path is the whole authorisation, as it is for the dispatch
 * job sheet (§4i). There is no session, and there is no endpoint that lists
 * reviews from a token — every query is `WHERE token_hash = $1`.
 *
 * A refusal answers 404 whether the token never existed, was tampered with, or
 * has lapsed. Distinguishing them here would turn this into an oracle for which
 * tokens are live; the PAGE names expiry, because a customer who followed a
 * real link deserves to know why it no longer works.
 *
 * Submitting UNPUBLISHES: an admin who approved a comment approved that text,
 * and silently republishing whatever replaced it would make moderation
 * meaningless. That is enforced in the SQL, not here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await submitReview(token, parsed.data);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.reason },
      {
        status: result.reason === "invalid" ? 422 : 404,
        headers: NO_STORE,
      },
    );
  }

  return Response.json({ ok: true }, { headers: NO_STORE });
}

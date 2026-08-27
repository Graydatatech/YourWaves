-- ---------------------------------------------------------------------------
-- 0022 — the customer says whether their words may go on the website.
--
-- Until now the promise was a sentence: "we will ask you first". Nothing in the
-- system held the answer, so publishing depended on somebody remembering to
-- ask and remembering what was said. A tick box on the survey makes it a
-- recorded fact instead of an intention.
--
-- DEFAULT false, so silence is a no. Consent that has to be withheld is not
-- consent, and a review submitted before this column existed was given under
-- the old promise — nobody agreed to anything, and defaulting those to true
-- would publish words on the strength of a migration.
--
-- ENFORCED IN THREE PLACES, on purpose:
--   the form         — the box, unticked, next to the words it governs
--   publish_review() — refuses without it, so a hand-written UPDATE or a future
--                      admin tool cannot skip the check
--   the public read  — filters on it, so even a row that somehow became
--                      published without consent still shows nobody anything
--
-- The last two are the ones that hold when someone is in a hurry.
-- ---------------------------------------------------------------------------

ALTER TABLE "reviews"
    ADD COLUMN IF NOT EXISTS "consent_to_publish" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "reviews"
    ADD COLUMN IF NOT EXISTS "consent_at" timestamp with time zone;
--> statement-breakpoint

COMMENT ON COLUMN "reviews"."consent_to_publish" IS
    'The customer ticked "you may show this on your website". false is the default and the answer for anyone who never saw the box.';
--> statement-breakpoint

COMMENT ON COLUMN "reviews"."consent_at" IS
    'When consent was last given. Cleared when it is withdrawn, so the pair records a decision rather than only a flag.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Publishing refuses without consent.
--
-- A function rather than a CHECK constraint: a CHECK would make the row itself
-- invalid and the failure would surface as a constraint violation with no
-- useful name. This returns a reason the back office can render.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_review(
    p_review_id uuid,
    p_publish   boolean
) RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql AS $$
DECLARE
    v_review reviews%ROWTYPE;
BEGIN
    SELECT * INTO v_review FROM reviews WHERE id = p_review_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'not_found'::text;
        RETURN;
    END IF;

    -- Unpublishing is always allowed. Taking something down must never be
    -- blocked by the same rule that governs putting it up.
    IF p_publish AND NOT v_review.consent_to_publish THEN
        RETURN QUERY SELECT false, 'no_consent'::text;
        RETURN;
    END IF;

    IF p_publish AND btrim(COALESCE(v_review.comment, '')) = '' THEN
        RETURN QUERY SELECT false, 'no_comment'::text;
        RETURN;
    END IF;

    UPDATE reviews
       SET is_published = p_publish,
           published_at = CASE WHEN p_publish THEN now() ELSE NULL END
     WHERE id = p_review_id;

    RETURN QUERY SELECT true, NULL::text;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION publish_review(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint

-- Anything already published without a recorded yes comes down. There should be
-- none — 0018 has not run anywhere yet — but "should be none" is not a reason
-- to leave the case unhandled.
UPDATE reviews
   SET is_published = false, published_at = NULL
 WHERE is_published AND NOT consent_to_publish;

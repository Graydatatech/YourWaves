-- ---------------------------------------------------------------------------
-- Post-activity surveys.
--
-- The day after a booking, the customer gets an email with a link to leave a
-- comment and a rating. An admin reads them in the back office and chooses
-- which to publish under "What guests say".
--
-- MODERATED, never automatic. A testimonial section that publishes whatever
-- arrives is a section that will one day publish something nobody wants on the
-- front page, at a moment nobody is watching.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "reviews" (
    "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ONE review per booking. The unique constraint is what makes
    -- enqueue_due_surveys idempotent: a second run inserts nothing rather than
    -- sending a second survey.
    "booking_id"   uuid NOT NULL UNIQUE
                   REFERENCES "bookings"("id") ON DELETE CASCADE,

    -- The link is the authorisation, exactly as §4i describes for dispatch:
    -- 32 bytes of randomness, stored ONLY as a sha256 hash, looked up by an
    -- indexed equality match. There is no dictionary to attack, so sha256 is
    -- right here and bcrypt's work factor would buy nothing.
    "token_hash"   text NOT NULL UNIQUE,
    "expires_at"   timestamp with time zone NOT NULL,

    -- Filled when the customer actually replies.
    "rating"       smallint CHECK (rating BETWEEN 1 AND 5),
    "comment"      text,
    -- What the customer wants to be called in public. Defaults from the
    -- booking, editable by them — a person may be happy to be quoted without
    -- their full name on a marketing page.
    "author_name"  text,
    "author_area"  text,
    "locale"       text NOT NULL DEFAULT 'ar',
    "submitted_at" timestamp with time zone,

    -- Moderation.
    "is_published" boolean NOT NULL DEFAULT false,
    "published_at" timestamp with time zone,

    "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),

    -- Nothing unanswered can be published. Without this an admin could publish
    -- an empty card, and the failure would be visible only on the home page.
    CONSTRAINT "reviews_published_needs_submission"
        CHECK (NOT is_published OR submitted_at IS NOT NULL)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "reviews_published_idx"
    ON "reviews" ("published_at" DESC) WHERE is_published;
--> statement-breakpoint

ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read and moderate; nobody else reaches the table directly. The
-- customer writes through a route handler that has already resolved their
-- token, exactly as the dispatch job sheet does.
DROP POLICY IF EXISTS "reviews_admin_all" ON "reviews";
--> statement-breakpoint

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE $p$
            CREATE POLICY "reviews_admin_all" ON "reviews"
                FOR ALL TO authenticated
                USING (auth_is_admin()) WITH CHECK (auth_is_admin())
        $p$;
        EXECUTE 'GRANT SELECT, UPDATE, DELETE ON "reviews" TO authenticated';
    END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- mint_review_token — same shape as mint_dispatch_token
--
--    Returns BOTH halves. The caller puts the raw token in the email and keeps
--    only the hash. Built-in sha256(bytea), not pgcrypto's digest(), so the
--    output matches Node's createHash("sha256").update(token).digest("hex")
--    byte for byte — that is what verifies the token on every page open.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mint_review_token()
RETURNS TABLE (token text, token_hash text)
LANGUAGE plpgsql AS $$
DECLARE
    v_token text;
BEGIN
    v_token := rtrim(
        translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'),
        '='
    );
    RETURN QUERY SELECT v_token, encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION mint_review_token() FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- enqueue_due_surveys — the scheduler's whole job
--
--    Finds bookings whose day was YESTERDAY in Qatar and which actually
--    happened, mints a review token for each, and queues the survey email.
--
--    IDEMPOTENT TWICE OVER, which is what lets the every-minute notifications
--    cron call it without a separate schedule of its own:
--      1. `reviews.booking_id` is UNIQUE, so a second run inserts nothing;
--      2. `notifications` is unique on (booking_id, template_key, recipient),
--         so even a lost review row could not produce a second email.
--
--    "Yesterday" rather than "today": the wave runs into the evening, and an
--    email asking how it went while the crew is still packing up reads as
--    though nobody was paying attention.
--
--    Cancelled and expired bookings are excluded, obviously. `holding` and
--    `pending` are too — money never moved, so there was no activity to ask
--    about.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_due_surveys()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking  RECORD;
    v_token    text;
    v_hash     text;
    v_payload  jsonb;
    v_count    integer := 0;
BEGIN
    FOR v_booking IN
        SELECT b.*
          FROM bookings b
          LEFT JOIN reviews r ON r.booking_id = b.id
         WHERE b.booking_date = ((now() AT TIME ZONE 'Asia/Qatar')::date - 1)
           AND b.status IN ('confirmed', 'assigned', 'en_route', 'completed')
           AND b.customer_email IS NOT NULL
           AND btrim(b.customer_email) <> ''
           AND r.id IS NULL
    LOOP
        SELECT token, token_hash INTO v_token, v_hash FROM mint_review_token();

        -- A month to reply. Long enough that a holiday does not lose the
        -- feedback, short enough that a leaked link is not live forever.
        INSERT INTO reviews (
            booking_id, token_hash, expires_at, author_name, author_area, locale
        ) VALUES (
            v_booking.id, v_hash, now() + interval '30 days',
            v_booking.customer_name, v_booking.area, v_booking.locale
        )
        ON CONFLICT (booking_id) DO NOTHING;

        -- The token travels in the PAYLOAD, not in a column the template reads
        -- later: §4g freezes the payload at enqueue time so a message sent
        -- after a retry describes the booking as it was.
        v_payload := booking_notification_payload(v_booking.id)
                     || jsonb_build_object('review_token', v_token);

        IF enqueue_notification(
               v_booking.id, 'email', 'customer', v_booking.customer_email,
               'booking_survey', v_booking.locale, v_payload
           ) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION enqueue_due_surveys() FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reviews_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS reviews_updated_at ON "reviews";
--> statement-breakpoint

CREATE TRIGGER reviews_updated_at
    BEFORE UPDATE ON "reviews"
    FOR EACH ROW EXECUTE FUNCTION reviews_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 0019 — the survey rides the completion, not the calendar.
--
-- 0018 sent it the day after the booking date, on a timer: enqueue_due_surveys()
-- swept for bookings whose day was yesterday and mailed each one. That was
-- wrong in two ways that only show up in operation:
--
--   It asked about a job nobody had confirmed happened. `booking_date` is when
--   the wave was BOOKED for. A crew that could not get the trailer through the
--   gate, a booking moved by phone, a day rained off — all of them still had a
--   date, so all of them got "how was the wave?" the next morning.
--
--   It arrived a day late for no gain. The reason given in 0018 was that the
--   wave runs into the evening and asking while the crew is packing up reads as
--   inattentive. But the office marking a booking `completed` IS the crew
--   having packed up — it is the event, not a proxy for it. Waiting a further
--   twenty-four hours only lets the day fade.
--
-- So the token is now minted when the booking reaches `completed`, and the link
-- travels IN the completion email rather than in a second message. That email
-- already ended "we would love to hear how it went" and then did not say how.
--
-- WHAT DOES NOT CHANGE: the review row, the hashed token, the thirty-day
-- expiry, the moderation flow and /r/<token> are all exactly as 0018 built
-- them. This migration changes WHEN a token is minted and WHICH email carries
-- it, and nothing else.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- enqueue_completion_with_survey — the completion email, carrying a review link
--
--    A dedicated function rather than a fourth parameter on
--    enqueue_booking_notifications. Adding `p_extra jsonb DEFAULT '{}'` there
--    would create an OVERLOAD, not an extension — Postgres resolves
--    enqueue_booking_notifications(id, key, true) against both candidates and
--    raises `function is not unique`. Every existing caller would break at the
--    moment this migration applied.
--
--    Mirrors enqueue_booking_notifications for the customer channels and
--    deliberately omits the admin copy: an admin who has just pressed
--    "completed" does not need an email telling them so.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_completion_with_survey(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_token   text;
    v_hash    text;
    v_payload jsonb;
    v_count   integer := 0;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN 0; END IF;

    v_payload := booking_notification_payload(p_booking_id);

    /*
     * A token only for a customer who can be sent one.
     *
     * The survey link is email-only — there is no approved WhatsApp template
     * for it — so minting a token for a booking with no address would create a
     * live capability URL that is never delivered and never used. The
     * completion email itself is still skipped by enqueue_notification when
     * customer_email is null, exactly as before.
     */
    IF v_booking.customer_email IS NOT NULL
       AND btrim(v_booking.customer_email) <> '' THEN

        SELECT token, token_hash INTO v_token, v_hash FROM mint_review_token();

        /*
         * ON CONFLICT DO NOTHING, then read back.
         *
         * reviews.booking_id is UNIQUE, so a booking driven to `completed`
         * twice — an admin correcting a mis-click, a re-run — keeps its FIRST
         * token. That matters: a customer may already be holding the link from
         * the first email, and minting a second would silently invalidate a URL
         * somebody is about to tap. If the insert loses, v_token is discarded
         * and no token goes into the payload; the notification's own unique
         * index on (booking_id, template_key, recipient) means the second
         * email is not queued either.
         */
        INSERT INTO reviews (
            booking_id, token_hash, expires_at, author_name, author_area, locale
        ) VALUES (
            p_booking_id, v_hash, now() + interval '30 days',
            v_booking.customer_name, v_booking.area, v_booking.locale
        )
        ON CONFLICT (booking_id) DO NOTHING;

        IF FOUND THEN
            -- The token travels in the PAYLOAD, never in a column the template
            -- reads later: §4g freezes the payload at enqueue time, so a
            -- message sent after a retry carries the token it was minted with.
            v_payload := v_payload || jsonb_build_object('review_token', v_token);
        END IF;
    END IF;

    IF enqueue_notification(p_booking_id, 'whatsapp', 'customer',
            v_booking.customer_phone, 'booking_completed', v_booking.locale,
            v_payload) IS NOT NULL THEN
        v_count := v_count + 1;
    END IF;

    IF v_booking.customer_email IS NOT NULL THEN
        IF enqueue_notification(p_booking_id, 'email', 'customer',
                v_booking.customer_email, 'booking_completed',
                v_booking.locale, v_payload) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END IF;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION enqueue_completion_with_survey(uuid) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The status trigger, with `completed` routed through the new function.
--
-- Identical to 0007's version in every other respect. Restated in full rather
-- than patched because CREATE OR REPLACE takes a whole body, and a future
-- reader comparing the two should be able to see the one line that differs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_template text;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    -- Completion is the one transition that carries a capability token, so it
    -- takes its own path instead of the generic enqueue.
    IF NEW.status = 'completed' THEN
        PERFORM enqueue_completion_with_survey(NEW.id);
        RETURN NEW;
    END IF;

    v_template := CASE NEW.status
        WHEN 'confirmed' THEN 'booking_confirmed'
        WHEN 'assigned'  THEN 'booking_assigned'
        WHEN 'en_route'  THEN 'booking_en_route'
        WHEN 'cancelled' THEN 'booking_cancelled'
        ELSE NULL
    END;

    IF v_template IS NULL THEN
        RETURN NEW;
    END IF;

    -- Only a new booking is worth interrupting an admin for; they watch the
    -- rest on the dashboard.
    PERFORM enqueue_booking_notifications(
        NEW.id, v_template, v_template = 'booking_confirmed');

    -- Being given a job is the driver's cue, so it rides the same transition.
    IF NEW.status = 'assigned' AND NEW.assigned_driver IS NOT NULL THEN
        PERFORM enqueue_driver_assignment(NEW.id);
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- enqueue_due_surveys — retired, not dropped.
--
-- The every-minute notifications cron called this. DROPping it would mean that
-- between this migration applying and the new build going live, every run of
-- that cron raises `function does not exist` — and that cron is what drains the
-- WHOLE outbox, so a rollout window of a few minutes would stop confirmation
-- emails, not just surveys.
--
-- A no-op returning 0 makes the order of migrate-and-deploy irrelevant. The
-- function can be dropped in a later migration once no deployed build calls it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_due_surveys()
RETURNS integer
LANGUAGE plpgsql AS $$
BEGIN
    -- Superseded by enqueue_completion_with_survey(), which runs from the
    -- status trigger. See the header of 0019.
    RETURN 0;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION enqueue_due_surveys() FROM PUBLIC;

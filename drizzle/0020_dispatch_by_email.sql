-- ---------------------------------------------------------------------------
-- 0020 — dispatch reaches a recipient by EMAIL.
--
-- Phase 9 built the whole thing around WhatsApp: the job sheet arrived as a
-- message, `dispatch_recipients` was keyed on a phone number and asked for no
-- email at all, and `create_booking_dispatch` enqueued on the `whatsapp`
-- channel. That depended on a Meta business account and an approved
-- `yw_dispatch_job` template, and neither exists — so no dispatch has ever been
-- delivered. Email is provisioned and already carries every customer message.
--
-- WHAT CHANGES: `booking_dispatch` records the address a job sheet was sent to,
-- and create_booking_dispatch enqueues on the `email` channel when it has one.
--
-- WHAT DOES NOT: the capability token, its hash, the expiry, per-recipient
-- revocation, the open log and the rate limits are exactly as 0010 built them.
-- The link is still the whole authorisation; only the envelope changed.
--
-- THE FALLBACK IS DELIBERATE. A recipient with no email still gets WhatsApp.
-- Every row that existed before this migration has a phone and no address, and
-- silently sending nothing to a driver who is expecting a job sheet is a worse
-- failure than sending it down a channel that may not be provisioned. The admin
-- form now requires an email, so the fallback stops firing as soon as the list
-- has been filled in once — it is a ramp, not a permanent second path.
-- ---------------------------------------------------------------------------

ALTER TABLE "booking_dispatch"
    ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint

COMMENT ON COLUMN "booking_dispatch"."email" IS
    'Address the job sheet was sent to. NULL means it went to the phone by WhatsApp — see 0020.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_booking_dispatch, taking an address.
--
-- DROPPED FIRST, and that is not tidiness. `CREATE OR REPLACE` matches on the
-- whole argument list, so a seventh parameter creates a SECOND function rather
-- than replacing the first — and every existing six-argument call would then
-- match both candidates and fail with `function is not unique`. The same trap
-- 0019 sidestepped by writing a new function instead of extending
-- enqueue_booking_notifications; here the extension is the right shape, so the
-- old signature has to go.
--
-- Safe to drop: PL/pgSQL bodies are resolved at execution, not at creation, so
-- the callers below hold no dependency on it, and they are recreated in this
-- same migration regardless.
--
-- p_email is LAST so every positional call site keeps its meaning. p_rotate
-- and the NO_PHONE guard are unchanged from 0010: rotate is what makes a
-- resend a real resend rather than the same dead token again, and the
-- ALREADY_DISPATCHED short-circuit is what stops the payment fan-out
-- re-minting everybody's link each time it runs.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS
    create_booking_dispatch(uuid, text, text, uuid, text, boolean);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION create_booking_dispatch(
    p_booking_id   uuid,
    p_phone        text,
    p_full_name    text,
    p_recipient_id uuid    DEFAULT NULL,
    p_locale       text    DEFAULT 'en',
    p_rotate       boolean DEFAULT false,
    p_email        text    DEFAULT NULL
) RETURNS TABLE (dispatch_id uuid, outcome text)
LANGUAGE plpgsql AS $$
DECLARE
    v_booking   bookings%ROWTYPE;
    v_existing  booking_dispatch%ROWTYPE;
    v_token     text;
    v_hash      text;
    v_expiry    timestamp with time zone;
    v_id        uuid;
    v_payload   jsonb;
    v_outcome   text;
    v_email     text := NULLIF(btrim(COALESCE(p_email, '')), '');
    v_channel   text;
    v_address   text;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::uuid, 'BOOKING_NOT_FOUND'::text;
        RETURN;
    END IF;

    -- Still keyed on the phone even when the message goes by email: it is the
    -- recipient's identity (0009's unique index) and what booking_dispatch
    -- matches an existing row on. An address can change; the person cannot.
    IF p_phone IS NULL OR btrim(p_phone) = '' THEN
        RETURN QUERY SELECT NULL::uuid, 'NO_PHONE'::text;
        RETURN;
    END IF;

    SELECT * INTO v_existing FROM booking_dispatch
     WHERE booking_id = p_booking_id AND phone = btrim(p_phone);

    -- A live link already exists and no rotation was asked for: nothing to do.
    IF FOUND AND NOT p_rotate AND v_existing.revoked_at IS NULL THEN
        RETURN QUERY SELECT v_existing.id, 'ALREADY_DISPATCHED'::text;
        RETURN;
    END IF;

    SELECT t.token, t.token_hash INTO v_token, v_hash FROM mint_dispatch_token() t;
    v_expiry := dispatch_token_expiry(v_booking.booking_date);

    IF v_existing.id IS NOT NULL THEN
        UPDATE booking_dispatch
           SET token_hash = v_hash,
               token_expires_at = v_expiry,
               full_name = p_full_name,
               email = v_email,
               locale = COALESCE(p_locale, locale),
               recipient_id = COALESCE(p_recipient_id, recipient_id),
               revoked_at = NULL,
               opened_at = NULL,
               sent_at = NULL
         WHERE id = v_existing.id
        RETURNING id INTO v_id;
        v_outcome := 'REDISPATCHED';
    ELSE
        INSERT INTO booking_dispatch
            (booking_id, recipient_id, phone, email, full_name, locale,
             token_hash, token_expires_at)
        VALUES (p_booking_id, p_recipient_id, btrim(p_phone), v_email,
                p_full_name, COALESCE(p_locale, 'en'), v_hash, v_expiry)
        RETURNING id INTO v_id;
        v_outcome := 'DISPATCHED';
    END IF;

    -- Everything the recipient needs before opening the link, plus the token
    -- that opens it.
    v_payload := booking_notification_payload(p_booking_id)
        || jsonb_build_object(
             'dispatch_token', v_token,
             'dispatch_id', v_id,
             'recipient_name', p_full_name);

    -- Email when we have one, WhatsApp when we do not. See the header: the
    -- fallback exists so a pre-0020 recipient is not silently sent nothing.
    IF v_email IS NOT NULL THEN
        v_channel := 'email';
        v_address := v_email;
    ELSE
        v_channel := 'whatsapp';
        v_address := btrim(p_phone);
    END IF;

    /*
     * Rotating a token kills the previous message, so the notification row is
     * REPLACED rather than deduplicated against.
     *
     * Matched on EITHER contact, not just the one being used now. A recipient
     * who has just been given an email address would otherwise keep a queued
     * WhatsApp row carrying a token that no longer opens anything, and receive
     * two messages of which the older is dead.
     */
    DELETE FROM notifications
     WHERE booking_id = p_booking_id
       AND template_key = 'dispatch_job'
       AND recipient IN (btrim(p_phone), COALESCE(v_email, btrim(p_phone)));

    PERFORM enqueue_notification(
        p_booking_id, v_channel, 'driver', v_address,
        'dispatch_job', COALESCE(p_locale, 'en'), v_payload);

    RETURN QUERY SELECT v_id, v_outcome;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION
    create_booking_dispatch(uuid, text, text, uuid, text, boolean, text)
    FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- enqueue_driver_assignment — pass the assigned recipient's address through.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_driver_assignment(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking   bookings%ROWTYPE;
    v_recipient dispatch_recipients%ROWTYPE;
    v_result    record;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND OR v_booking.assigned_driver IS NULL THEN RETURN 0; END IF;

    SELECT * INTO v_recipient FROM dispatch_recipients
     WHERE id = v_booking.assigned_driver;
    IF NOT FOUND THEN RETURN 0; END IF;

    SELECT * INTO v_result FROM create_booking_dispatch(
        p_booking_id, v_recipient.phone, v_recipient.full_name,
        v_recipient.id, 'en', false, v_recipient.email);

    RETURN CASE WHEN v_result.outcome IN ('DISPATCHED','REDISPATCHED')
                THEN 1 ELSE 0 END;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The payment fan-out — every default recipient, now by address.
--
-- Restated in full rather than patched, for the reason 0019 gives: CREATE OR
-- REPLACE takes a whole body, and the one changed line should be visible to
-- somebody diffing this against 0010.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_default_recipients(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    r         dispatch_recipients%ROWTYPE;
    v_count   integer := 0;
    v_result  record;
BEGIN
    FOR r IN
        SELECT * FROM dispatch_recipients
         WHERE is_active AND is_default ORDER BY full_name
    LOOP
        SELECT * INTO v_result
          FROM create_booking_dispatch(
                   p_booking_id, r.phone, r.full_name, r.id, 'en', false,
                   r.email);
        IF v_result.outcome IN ('DISPATCHED', 'REDISPATCHED') THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION dispatch_default_recipients(uuid) FROM PUBLIC;

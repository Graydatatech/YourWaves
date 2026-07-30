-- ==========================================================================
-- 0010 — dispatch by link, not by login
--
-- SCOPE CHANGE. Phase 8 assumed drivers would eventually sign in: `drivers`
-- carried a `user_id`, `user_roles` had a 'driver' role, and RLS let such a
-- login read its own bookings. None of that is wanted. Drivers never create an
-- account, never install anything, and never see the dashboard — everything
-- they need arrives as a WhatsApp message with a link.
--
-- So this migration does two things at once:
--
--   1. TURNS `drivers` INTO `dispatch_recipients`. Same rows, renamed and
--      reshaped: a recipient is anyone who should receive a job — the assigned
--      driver, a supervisor, the technician, the owner. Renaming rather than
--      creating a second table keeps every foreign key, index and grant that
--      already points at it, and there is never a moment where both exist.
--
--   2. REMOVES the driver login entirely. The 'driver' role, `auth_driver_id()`
--      and the two driver RLS policies go. What replaces them is a capability
--      token per recipient per booking, which is the only thing standing
--      between a stranger and a customer's home address — so the rest of this
--      file is mostly about treating that seriously.
-- ==========================================================================

-- pgcrypto supplies gen_random_bytes(). Supabase enables it by default; a
-- plain Postgres may not, and the token minting below is useless without it.
-- Hashing deliberately uses the BUILT-IN sha256() instead, so the digest a
-- trigger computes and the one Node computes are the same function.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 1. drivers → dispatch_recipients
-- -------------------------------------------------------------------------
ALTER TABLE IF EXISTS "drivers" RENAME TO "dispatch_recipients";
--> statement-breakpoint

ALTER TABLE "dispatch_recipients"
    -- A driver login is gone, so the link to auth.users goes with it.
    DROP COLUMN IF EXISTS "user_id",
    -- Dispatch is WhatsApp-only now. Nothing reads this and keeping it would
    -- imply an email path that no longer exists.
    DROP COLUMN IF EXISTS "email",
    ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'driver',
    -- Included on every new booking automatically. The owner decides who.
    ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "dispatch_recipients"
    DROP CONSTRAINT IF EXISTS "dispatch_recipients_role_check";
--> statement-breakpoint

ALTER TABLE "dispatch_recipients"
    ADD CONSTRAINT "dispatch_recipients_role_check"
    CHECK (role IN ('driver', 'owner', 'supervisor', 'other'));
--> statement-breakpoint

-- The unique-phone index from 0009 followed the rename; give it the new name so
-- the constraint and the table agree.
ALTER INDEX IF EXISTS "drivers_phone_key" RENAME TO "dispatch_recipients_phone_key";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dispatch_recipients_default_idx"
    ON "dispatch_recipients" ("is_default") WHERE is_default AND is_active;
--> statement-breakpoint

-- `bookings.assigned_driver` keeps its name: it still means "the person driving
-- this job", and the FK followed the rename automatically. It now points at a
-- dispatch_recipients row whose role is normally 'driver'.

-- -------------------------------------------------------------------------
-- 2. Retire the driver login
--
--    Done BEFORE booking_dispatch so that a half-applied migration cannot
--    leave a driver role with no policies to constrain it.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "bookings_driver_read_own" ON "bookings";
--> statement-breakpoint
DROP POLICY IF EXISTS "booking_events_driver_read_own" ON "booking_events";
--> statement-breakpoint
DROP POLICY IF EXISTS "drivers_read_self" ON "dispatch_recipients";
--> statement-breakpoint
DROP POLICY IF EXISTS "drivers_admin_all" ON "dispatch_recipients";
--> statement-breakpoint

DROP POLICY IF EXISTS "dispatch_recipients_admin_all" ON "dispatch_recipients";
--> statement-breakpoint

CREATE POLICY "dispatch_recipients_admin_all" ON "dispatch_recipients"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

-- Any driver login that exists is now an account with no purpose. Removing the
-- rows is the point: leaving them would leave real credentials that grant
-- nothing but still authenticate.
DELETE FROM "user_roles" WHERE role = 'driver';
--> statement-breakpoint

ALTER TABLE "user_roles"
    DROP CONSTRAINT IF EXISTS "user_roles_driver_needs_driver_id";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_check";
--> statement-breakpoint
ALTER TABLE "user_roles"
    ADD CONSTRAINT "user_roles_role_check" CHECK (role IN ('admin'));
--> statement-breakpoint
ALTER TABLE "user_roles" DROP COLUMN IF EXISTS "driver_id";
--> statement-breakpoint

DROP FUNCTION IF EXISTS public.auth_driver_id();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. booking_dispatch — one link per recipient per booking
--
--    ONE TOKEN PER RECIPIENT, not per booking. That is what makes the audit
--    trail say who acted, and what makes revocation individual: taking the
--    supervisor's link away must not break the driver's.
--
--    Only the HASH is stored. A leaked database row cannot be turned back into
--    a working link.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "booking_dispatch" (
    "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "booking_id"        uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    -- Nullable: an admin can dispatch to a one-off number without saving it.
    "recipient_id"      uuid REFERENCES "dispatch_recipients"("id") ON DELETE SET NULL,
    "phone"             text NOT NULL,
    "full_name"         text NOT NULL,
    "locale"            text NOT NULL DEFAULT 'en',
    "token_hash"        text NOT NULL,
    "token_expires_at"  timestamp with time zone NOT NULL,
    "sent_at"           timestamp with time zone,
    "opened_at"         timestamp with time zone,
    "revoked_at"        timestamp with time zone,
    "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
    -- One link per person per job. A resend reuses the row rather than minting
    -- a second live token for the same phone.
    CONSTRAINT "booking_dispatch_booking_phone_key" UNIQUE (booking_id, phone)
);
--> statement-breakpoint

-- The lookup on every page open. Unique because a hash collision would mean one
-- link opening someone else's job.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_dispatch_token_hash_key"
    ON "booking_dispatch" ("token_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_dispatch_booking_idx"
    ON "booking_dispatch" ("booking_id", "created_at");
--> statement-breakpoint

ALTER TABLE "booking_dispatch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admin-only. The token endpoints run on the server-side owner connection and
-- are scoped by the token itself, not by a policy.
DROP POLICY IF EXISTS "booking_dispatch_admin_all" ON "booking_dispatch";
--> statement-breakpoint

CREATE POLICY "booking_dispatch_admin_all" ON "booking_dispatch"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "booking_dispatch" TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 4. Every open is logged
--
--    Doubles as the rate-limit source. "Who looked at this customer's address,
--    and from where?" has to be answerable, and the same rows answer "has this
--    token been hit fifty times in a minute?".
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "dispatch_access_log" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "dispatch_id" uuid REFERENCES "booking_dispatch"("id") ON DELETE CASCADE,
    -- Recorded even when no dispatch matched, so a scan for valid tokens is
    -- visible rather than invisible.
    "token_hash"  text,
    "ip"          inet,
    "user_agent"  text,
    "outcome"     text NOT NULL,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dispatch_access_log_recent_idx"
    ON "dispatch_access_log" ("created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dispatch_access_log_ip_idx"
    ON "dispatch_access_log" ("ip", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dispatch_access_log_dispatch_idx"
    ON "dispatch_access_log" ("dispatch_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "dispatch_access_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "dispatch_access_log_admin_read" ON "dispatch_access_log";
--> statement-breakpoint

CREATE POLICY "dispatch_access_log_admin_read" ON "dispatch_access_log"
    FOR SELECT TO authenticated USING (auth_is_admin());
--> statement-breakpoint

GRANT SELECT ON "dispatch_access_log" TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 5. Actions, with an idempotency key
--
--    A driver taps "On my way" in a tunnel. The request fails, the browser
--    queues it, and it is replayed on reconnect — possibly more than once, and
--    possibly after they have already tapped again. `client_action_id` is
--    generated on the device and unique per dispatch, so a replay is recorded
--    once and applied once.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "booking_dispatch_actions" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "dispatch_id"      uuid NOT NULL REFERENCES "booking_dispatch"("id") ON DELETE CASCADE,
    "client_action_id" text NOT NULL,
    "action"           text NOT NULL,
    "outcome"          text NOT NULL,
    "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "booking_dispatch_actions_idem_key"
        UNIQUE (dispatch_id, client_action_id)
);
--> statement-breakpoint

ALTER TABLE "booking_dispatch_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "booking_dispatch_actions_admin_read" ON "booking_dispatch_actions";
--> statement-breakpoint

CREATE POLICY "booking_dispatch_actions_admin_read" ON "booking_dispatch_actions"
    FOR SELECT TO authenticated USING (auth_is_admin());
--> statement-breakpoint

GRANT SELECT ON "booking_dispatch_actions" TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 6. Token minting
--
--    32 bytes of pgcrypto randomness, URL-safe, hashed with SHA-256 for
--    storage. SHA-256 rather than bcrypt on purpose: the token is looked up by
--    hash on every page open, which needs an indexed equality match, and a
--    32-byte random secret has no dictionary to attack — bcrypt's work factor
--    protects low-entropy passwords, not this.
--
--    Returns BOTH halves. The caller puts the raw token in the message and
--    keeps only the hash.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mint_dispatch_token()
RETURNS TABLE (token text, token_hash text)
LANGUAGE plpgsql AS $$
DECLARE
    v_token text;
BEGIN
    v_token := rtrim(
        translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'),
        '='
    );
    -- Built-in sha256(bytea), not pgcrypto's digest(): identical output to
    -- Node's createHash("sha256").update(token).digest("hex"), which is what
    -- verifies the token on every page open.
    RETURN QUERY SELECT v_token, encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION mint_dispatch_token() FROM PUBLIC;
--> statement-breakpoint

/**
 * End of the booking day, plus 24 hours, in Qatar.
 *
 * Not "created_at + N days": a job booked two months out would otherwise carry
 * a link that is live for two months. Tying expiry to the DAY OF WORK means the
 * window is the same whether the booking was made yesterday or in March.
 */
CREATE OR REPLACE FUNCTION dispatch_token_expiry(p_booking_date date)
RETURNS timestamp with time zone
LANGUAGE sql IMMUTABLE AS $$
    SELECT ((p_booking_date + 2)::timestamp AT TIME ZONE 'Asia/Qatar');
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 7. create_booking_dispatch — mint, store, and queue the message
--
--    One transaction: a dispatch row without its WhatsApp message is a driver
--    who was never told, and a message without a row is a link nobody can
--    revoke.
--
--    The RAW TOKEN goes into the notification payload, because the message has
--    to contain the link and the hash cannot be reversed. That payload is
--    admin-only under RLS, the token expires on its own, and revoking the
--    dispatch kills it regardless of who read the row — which is the same
--    posture as the one-time code phase 4 puts in a WhatsApp message.
--
--    Idempotent per (booking, phone): calling it again reuses the existing row
--    and does NOT mint a second live token. Pass p_rotate to deliberately
--    replace the token (a genuine resend to someone who lost the message).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_booking_dispatch(
    p_booking_id   uuid,
    p_phone        text,
    p_full_name    text,
    p_recipient_id uuid DEFAULT NULL,
    p_locale       text DEFAULT 'en',
    p_rotate       boolean DEFAULT false
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
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::uuid, 'BOOKING_NOT_FOUND'::text;
        RETURN;
    END IF;

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

    IF FOUND AND v_existing.id IS NOT NULL THEN
        UPDATE booking_dispatch
           SET token_hash = v_hash,
               token_expires_at = v_expiry,
               full_name = p_full_name,
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
            (booking_id, recipient_id, phone, full_name, locale,
             token_hash, token_expires_at)
        VALUES (p_booking_id, p_recipient_id, btrim(p_phone), p_full_name,
                COALESCE(p_locale, 'en'), v_hash, v_expiry)
        RETURNING id INTO v_id;
        v_outcome := 'DISPATCHED';
    END IF;

    -- The message. Everything the recipient needs before opening the link, plus
    -- the token that opens it.
    v_payload := booking_notification_payload(p_booking_id)
        || jsonb_build_object(
             'dispatch_token', v_token,
             'dispatch_id', v_id,
             'recipient_name', p_full_name);

    -- Rotating a token means the old message is dead, so the notification row
    -- must be replaced rather than deduplicated against.
    DELETE FROM notifications
     WHERE booking_id = p_booking_id
       AND template_key = 'dispatch_job'
       AND recipient = btrim(p_phone);

    PERFORM enqueue_notification(
        p_booking_id, 'whatsapp', 'driver', btrim(p_phone),
        'dispatch_job', COALESCE(p_locale, 'en'), v_payload);

    RETURN QUERY SELECT v_id, v_outcome;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION create_booking_dispatch(uuid, text, text, uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 8. dispatch_default_recipients — the automatic fan-out
--
--    Called when a booking is confirmed. Every active default recipient gets
--    their own link.
-- -------------------------------------------------------------------------
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
          FROM create_booking_dispatch(p_booking_id, r.phone, r.full_name, r.id, 'en');
        IF v_result.outcome IN ('DISPATCHED', 'REDISPATCHED') THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION dispatch_default_recipients(uuid) FROM PUBLIC;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 9. enqueue_driver_assignment, rewritten
--
--    Was: email + WhatsApp to a driver who might log in. Now: mint that
--    driver their own dispatch link, exactly like any other recipient.
-- -------------------------------------------------------------------------
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
        v_recipient.id, 'en');

    RETURN CASE WHEN v_result.outcome IN ('DISPATCHED','REDISPATCHED') THEN 1 ELSE 0 END;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 10. Fire on confirmation
--
--     Extends the 0007 status trigger. A paid booking dispatches itself: that
--     is the trigger the client actually asked for — payment done, WhatsApp
--     out — and putting it in the same transaction as the status change means
--     a confirmed booking with nobody told is not a reachable state.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_template text;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    v_template := CASE NEW.status
        WHEN 'confirmed' THEN 'booking_confirmed'
        WHEN 'assigned'  THEN 'booking_assigned'
        WHEN 'en_route'  THEN 'booking_en_route'
        WHEN 'completed' THEN 'booking_completed'
        WHEN 'cancelled' THEN 'booking_cancelled'
        ELSE NULL
    END;

    IF v_template IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM enqueue_booking_notifications(
        NEW.id, v_template, v_template = 'booking_confirmed');

    -- Payment confirmed → the crew is told, without an admin touching anything.
    IF NEW.status = 'confirmed' THEN
        PERFORM dispatch_default_recipients(NEW.id);
    END IF;

    IF NEW.status = 'assigned' AND NEW.assigned_driver IS NOT NULL THEN
        PERFORM enqueue_driver_assignment(NEW.id);
    END IF;

    -- A cancelled job must not leave live links to the customer's address.
    IF NEW.status IN ('cancelled', 'completed', 'expired') THEN
        UPDATE booking_dispatch
           SET revoked_at = now()
         WHERE booking_id = NEW.id AND revoked_at IS NULL
           -- A completed job keeps its links briefly so the crew can still see
           -- what they just finished; a cancelled one is cut immediately.
           AND NEW.status = 'cancelled';
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 11. Revoking a recipient revokes their live links
--
--     Deactivating someone in settings has to take their access away
--     everywhere, not just stop future dispatches.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revoke_dispatch_for_recipient() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR (OLD.is_active AND NOT NEW.is_active) THEN
        UPDATE booking_dispatch
           SET revoked_at = now()
         WHERE recipient_id = OLD.id AND revoked_at IS NULL;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "dispatch_recipients_revoke" ON "dispatch_recipients";
--> statement-breakpoint

CREATE TRIGGER "dispatch_recipients_revoke"
    BEFORE UPDATE OR DELETE ON "dispatch_recipients"
    FOR EACH ROW EXECUTE FUNCTION revoke_dispatch_for_recipient();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 12. Seed: the existing drivers become default recipients
--
--     Without this the first confirmed booking after the migration would
--     dispatch to nobody, silently.
-- -------------------------------------------------------------------------
UPDATE "dispatch_recipients"
   SET role = 'driver', is_default = true
 WHERE is_active AND role = 'driver';
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 13. Functions that still name `drivers`
--
--     plpgsql compiles a body on first execution, not at CREATE time, so a
--     `drivers%ROWTYPE` in a function nobody has called yet survives the rename
--     silently and then fails at runtime — which is exactly how this was found.
--     Both surviving references are rewritten here.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_notification_payload(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_booking  bookings%ROWTYPE;
    v_driver   dispatch_recipients%ROWTYPE;
    v_settings settings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO v_settings FROM settings WHERE id = 1;
    IF v_booking.assigned_driver IS NOT NULL THEN
        SELECT * INTO v_driver FROM dispatch_recipients
         WHERE id = v_booking.assigned_driver;
    END IF;

    RETURN jsonb_strip_nulls(jsonb_build_object(
        'reference',       v_booking.reference,
        'status',          v_booking.status,
        'booking_date',    to_char(v_booking.booking_date, 'YYYY-MM-DD'),
        'preferred_start', to_char(v_booking.preferred_start, 'HH24:MI:SS'),
        'customer_name',   v_booking.customer_name,
        'customer_phone',  v_booking.customer_phone,
        'customer_email',  v_booking.customer_email,
        'address_line',    v_booking.address_line,
        'area',            v_booking.area,
        'city',            v_booking.city,
        'maps_url',        v_booking.maps_url,
        'lat',             v_booking.lat,
        'lng',             v_booking.lng,
        'notes',           v_booking.notes,
        'locale',          v_booking.locale,
        'price_rental',    v_booking.price_rental,
        'price_setup',     v_booking.price_setup,
        'price_delivery',  v_booking.price_delivery,
        'price_total',     v_booking.price_total,
        'currency',        v_booking.currency,
        'driver_name',     v_driver.full_name,
        'driver_phone',    v_driver.phone,
        'service_areas',   to_jsonb(v_settings.service_areas)
    ));
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION assign_driver(
    p_booking_id uuid,
    p_driver_id  uuid,
    p_actor_id   text DEFAULT NULL
) RETURNS TABLE (
    outcome           text,
    previous_driver   uuid,
    booking_status    booking_status
)
LANGUAGE plpgsql AS $$
DECLARE
    v_booking  bookings%ROWTYPE;
    v_driver   dispatch_recipients%ROWTYPE;
    v_previous uuid;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'BOOKING_NOT_FOUND'::text, NULL::uuid, NULL::booking_status;
        RETURN;
    END IF;

    SELECT * INTO v_driver FROM dispatch_recipients WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'DRIVER_NOT_FOUND'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;
    IF NOT v_driver.is_active THEN
        RETURN QUERY SELECT 'DRIVER_INACTIVE'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;

    IF v_booking.status NOT IN ('confirmed', 'assigned', 'en_route') THEN
        RETURN QUERY SELECT 'BOOKING_NOT_DISPATCHABLE'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;

    v_previous := v_booking.assigned_driver;

    IF v_previous = p_driver_id AND v_booking.status <> 'confirmed' THEN
        RETURN QUERY SELECT 'UNCHANGED'::text, v_previous, v_booking.status;
        RETURN;
    END IF;

    UPDATE bookings SET assigned_driver = p_driver_id, updated_at = now()
     WHERE id = p_booking_id;

    IF v_booking.status = 'confirmed' THEN
        UPDATE bookings SET status = 'assigned', updated_at = now()
         WHERE id = p_booking_id;
    ELSE
        PERFORM enqueue_driver_assignment(p_booking_id);
    END IF;

    -- The outgoing driver's link dies with the reassignment: they are no longer
    -- entitled to the customer's address.
    IF v_previous IS NOT NULL AND v_previous <> p_driver_id THEN
        UPDATE booking_dispatch
           SET revoked_at = now()
         WHERE booking_id = p_booking_id
           AND recipient_id = v_previous
           AND revoked_at IS NULL;
    END IF;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, actor_id, metadata)
    VALUES (
        p_booking_id, v_booking.status,
        (SELECT status FROM bookings WHERE id = p_booking_id),
        'admin', p_actor_id,
        jsonb_build_object(
            'reason', CASE WHEN v_previous IS NULL THEN 'driver_assigned'
                           ELSE 'driver_reassigned' END,
            'driver_id', p_driver_id,
            'driver_name', v_driver.full_name,
            'previous_driver_id', v_previous)
    );

    RETURN QUERY SELECT
        CASE WHEN v_previous IS NULL THEN 'ASSIGNED' ELSE 'REASSIGNED' END,
        v_previous,
        (SELECT status FROM bookings WHERE id = p_booking_id);
END;
$$;

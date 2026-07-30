-- =========================================================================
-- Booking integrity and the checkout lock.
--
-- Everything in this file is hand-written rather than generated, because it is
-- the part the rest of the system depends on being exactly right. Phase 5
-- (payments) drives the hold -> pending -> confirmed sequence through the
-- functions defined here.
--
-- The central guarantee: a date can be occupied by at most ONE booking. That
-- is enforced by a partial unique index below, not by application code. Any
-- race between two concurrent checkouts is resolved by Postgres.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Human-readable booking references: YW-2026-0417
--    The counter restarts each Qatar calendar year. INSERT .. ON CONFLICT
--    makes allocation atomic, so concurrent bookings cannot collide.
-- -------------------------------------------------------------------------
CREATE TABLE "booking_reference_counters" (
    "year" integer PRIMARY KEY,
    "last_value" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION next_booking_reference() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_year integer;
    v_next integer;
BEGIN
    -- The year is the Qatar year, not the server's.
    v_year := extract(year FROM (now() AT TIME ZONE 'Asia/Qatar'))::integer;

    INSERT INTO booking_reference_counters AS c (year, last_value)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_value = c.last_value + 1
    RETURNING c.last_value INTO v_next;

    RETURN 'YW-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
END;
$$;
--> statement-breakpoint

ALTER TABLE "bookings"
    ALTER COLUMN "reference" SET DEFAULT next_booking_reference();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 2. THE CORE CONSTRAINT (SRS 3.2)
--
--    One booking per calendar day. `cancelled` and `expired` rows are excluded
--    from the index, so a released date becomes immediately bookable again
--    while the historical row is preserved.
--
--    NOTE: this list must stay in step with BLOCKING_STATUSES in
--    src/db/schema.ts. A test asserts the two agree.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "bookings_active_date_key"
    ON "bookings" ("booking_date")
    WHERE status IN (
        'holding', 'pending', 'confirmed', 'assigned', 'en_route', 'completed'
    );
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. Row-level invariants
-- -------------------------------------------------------------------------

-- hold_expires_at is meaningful only while the row is holding. Transitions go
-- through transition_booking_status(), which clears it on the way out.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hold_expires_at_check" CHECK (
    (status = 'holding' AND hold_expires_at IS NOT NULL)
    OR (status <> 'holding' AND hold_expires_at IS NULL)
);
--> statement-breakpoint

-- Money is minor units and must add up; this stops a mispriced booking from
-- ever being written, whatever the caller believes.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_total_check"
    CHECK (price_total = price_rental + price_setup + price_delivery);
--> statement-breakpoint

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_non_negative_check"
    CHECK (price_rental >= 0 AND price_setup >= 0 AND price_delivery >= 0);
--> statement-breakpoint

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_locale_check"
    CHECK (locale IN ('ar', 'en'));
--> statement-breakpoint

-- settings is a singleton so `SELECT * FROM settings` is never ambiguous.
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton_check" CHECK (id = 1);
--> statement-breakpoint

-- A replayed provider webhook must not create a second payment row.
CREATE UNIQUE INDEX "payments_provider_ref_key"
    ON "payments" ("provider", "provider_ref")
    WHERE provider_ref IS NOT NULL;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 4. updated_at maintenance
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "bookings_touch_updated_at" BEFORE UPDATE ON "bookings"
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint

CREATE TRIGGER "payments_touch_updated_at" BEFORE UPDATE ON "payments"
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint

CREATE TRIGGER "settings_touch_updated_at" BEFORE UPDATE ON "settings"
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 5. booking_events is append-only
--    An audit trail that can be edited is not an audit trail.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'booking_events is append-only (attempted %)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "booking_events_no_mutation"
    BEFORE UPDATE OR DELETE ON "booking_events"
    FOR EACH ROW EXECUTE FUNCTION booking_events_append_only();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 6. active_bookings -- what "occupied" means, in one place
--
--    A holding row whose lock has lapsed but has not yet been swept still
--    physically exists and still occupies the partial unique index. Reads must
--    not report that date as taken, so the view filters lapsed holds out.
--    Writes call expire_stale_holds() first, which removes them from the index.
-- -------------------------------------------------------------------------
CREATE VIEW "active_bookings" WITH (security_invoker = true) AS
    SELECT *
    FROM bookings
    WHERE status IN (
        'holding', 'pending', 'confirmed', 'assigned', 'en_route', 'completed'
    )
    AND (status <> 'holding' OR hold_expires_at > now());
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 7. expire_stale_holds -- release lapsed checkout locks
--
--    Idempotent and safe to run concurrently. Call it from a scheduled job and
--    before any write that needs a date; reads do not need it because
--    active_bookings already ignores lapsed holds.
--    Returns the number of holds released.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_stale_holds(p_booking_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_count integer;
BEGIN
    WITH released AS (
        UPDATE bookings
           SET status = 'expired',
               hold_expires_at = NULL,
               updated_at = now()
         WHERE status = 'holding'
           AND hold_expires_at <= now()
           AND (p_booking_date IS NULL OR booking_date = p_booking_date)
        RETURNING id
    ), logged AS (
        INSERT INTO booking_events
            (booking_id, from_status, to_status, actor_type, metadata)
        SELECT id, 'holding', 'expired', 'system',
               jsonb_build_object('reason', 'hold_lapsed')
        FROM released
        RETURNING 1
    )
    SELECT count(*)::integer INTO v_count FROM logged;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 8. create_booking_hold -- the checkout lock
--
--    Atomically claims a date for settings.hold_minutes. Two customers racing
--    for the same day: one gets the row, the other gets 'date_unavailable'.
--
--    Ordering matters:
--      a) take a transaction-scoped advisory lock keyed on the date, so
--         concurrent callers serialise rather than both passing the checks;
--      b) sweep lapsed holds for that date, or the unique index would reject a
--         legitimate new hold;
--      c) reject blackout dates;
--      d) insert -- the partial unique index is the final arbiter.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_booking_hold(
    p_booking_date    date,
    p_preferred_start time,
    p_customer_name   text,
    p_customer_phone  text,
    p_address_line    text,
    p_customer_email  text DEFAULT NULL,
    p_area            text DEFAULT NULL,
    p_city            text DEFAULT NULL,
    p_maps_url        text DEFAULT NULL,
    p_lat             numeric DEFAULT NULL,
    p_lng             numeric DEFAULT NULL,
    p_notes           text DEFAULT NULL,
    p_locale          text DEFAULT 'ar'
) RETURNS bookings
LANGUAGE plpgsql AS $$
DECLARE
    v_settings settings%ROWTYPE;
    v_booking  bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_settings FROM settings WHERE id = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'settings_missing'
            USING ERRCODE = 'no_data_found',
                  HINT = 'Run the seed: pnpm db:seed';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext('yourwaves:booking_date:' || p_booking_date::text)
    );

    PERFORM expire_stale_holds(p_booking_date);

    IF EXISTS (SELECT 1 FROM blackout_dates WHERE date = p_booking_date) THEN
        RAISE EXCEPTION 'date_blacked_out'
            USING ERRCODE = 'check_violation';
    END IF;

    BEGIN
        INSERT INTO bookings (
            booking_date, preferred_start, status, hold_expires_at,
            customer_name, customer_phone, customer_email,
            address_line, area, city, maps_url, lat, lng, notes, locale,
            price_rental, price_setup, price_delivery, price_total, currency
        ) VALUES (
            p_booking_date,
            p_preferred_start,
            'holding',
            now() + make_interval(mins => v_settings.hold_minutes),
            p_customer_name, p_customer_phone, p_customer_email,
            p_address_line, p_area, p_city, p_maps_url, p_lat, p_lng,
            p_notes, p_locale,
            v_settings.price_rental,
            v_settings.price_setup,
            v_settings.price_delivery,
            v_settings.price_rental + v_settings.price_setup
                + v_settings.price_delivery,
            v_settings.currency
        )
        RETURNING * INTO v_booking;
    EXCEPTION WHEN unique_violation THEN
        -- The partial unique index rejected us: somebody else holds this date.
        RAISE EXCEPTION 'date_unavailable'
            USING ERRCODE = 'unique_violation';
    END;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, metadata)
    VALUES (
        v_booking.id, NULL, 'holding', 'customer',
        jsonb_build_object('hold_minutes', v_settings.hold_minutes)
    );

    RETURN v_booking;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 9. transition_booking_status -- the only sanctioned way to change status
--
--    Validates the transition, keeps hold_expires_at consistent with the CHECK
--    constraint, and writes the audit row in the same transaction, so a status
--    change without a matching event is impossible.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transition_booking_status(
    p_booking_id  uuid,
    p_to_status   booking_status,
    p_actor_type  actor_type DEFAULT 'system',
    p_actor_id    text DEFAULT NULL,
    p_metadata    jsonb DEFAULT '{}'::jsonb
) RETURNS bookings
LANGUAGE plpgsql AS $$
DECLARE
    v_from    booking_status;
    v_allowed booking_status[];
    v_booking bookings%ROWTYPE;
BEGIN
    -- Lock the row so two actors cannot transition it simultaneously.
    SELECT status INTO v_from FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'booking_not_found' USING ERRCODE = 'no_data_found';
    END IF;

    v_allowed := CASE v_from
        WHEN 'holding'   THEN ARRAY['pending','cancelled','expired']
        WHEN 'pending'   THEN ARRAY['confirmed','cancelled','expired']
        WHEN 'confirmed' THEN ARRAY['assigned','cancelled']
        WHEN 'assigned'  THEN ARRAY['en_route','confirmed','cancelled']
        WHEN 'en_route'  THEN ARRAY['completed','cancelled']
        ELSE ARRAY[]::text[]  -- completed / cancelled / expired are terminal
    END::booking_status[];

    IF NOT (p_to_status = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'illegal_transition: % -> %', v_from, p_to_status
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE bookings
       SET status = p_to_status,
           -- The CHECK constraint requires this to be NULL off 'holding'.
           hold_expires_at = CASE
               WHEN p_to_status = 'holding' THEN hold_expires_at
               ELSE NULL
           END
     WHERE id = p_booking_id
    RETURNING * INTO v_booking;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, actor_id, metadata)
    VALUES (p_booking_id, v_from, p_to_status, p_actor_type, p_actor_id,
            COALESCE(p_metadata, '{}'::jsonb));

    RETURN v_booking;
END;
$$;

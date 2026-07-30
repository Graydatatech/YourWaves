-- =========================================================================
-- Checkout holds (SRS 3.2, 4.3). The highest-risk code in the project.
--
-- GUARANTEE: a calendar date can be occupied by at most one booking, under any
-- amount of concurrency, with no application cooperation required.
--
-- Three independent layers, in order of who wins:
--
--   1. A per-DATE transaction advisory lock. Two attempts on the same date
--      serialise; attempts on different dates do not touch each other. This is
--      what makes the availability re-check meaningful — the check happens
--      AFTER the lock is held, so nothing can change underneath it.
--   2. The availability re-check itself, entirely inside the lock.
--   3. The partial unique index from 0001 as the backstop. If layers 1 and 2
--      were ever both bypassed, Postgres still refuses the second row. The
--      function catches 23505 and reports DATE_TAKEN rather than a 500.
--
-- Layer 3 is not decoration: it is the only layer that holds if a future
-- migration, an admin tool or a hand-written query inserts a booking without
-- going through this function.
-- =========================================================================

-- A payment that was started for a hold which then lapsed. Distinct from
-- 'failed' (the gateway rejected it) — nobody ever tried to complete this one.
-- Safe in this transaction: the value is only ever USED at function-execution
-- time, which is after this migration commits.
ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'abandoned';
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- Lock key helper.
--
-- 0001 used hashtext(), which can collide: two unrelated dates hashing to the
-- same int would serialise against each other. Harmless for correctness but it
-- silently destroys the per-date parallelism the design depends on, and it makes
-- "date X does not block date Y" untestable. The epoch day number is unique per
-- date by construction, so use that with a fixed namespace instead.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_date_lock_key(p_booking_date date)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_booking_date - DATE '1970-01-01')::integer
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- create_booking_hold — claim a date for settings.hold_minutes.
--
-- Returns a ROW rather than raising, so the API maps a machine-readable code to
-- a bilingual message instead of parsing exception text. `error_code` is NULL on
-- success.
--
-- Codes: DATE_TAKEN, DATE_BLACKOUT, DATE_PAST, DATE_TOO_SOON,
--        DATE_OUT_OF_RANGE, INVALID_START_TIME, SETTINGS_MISSING
--
-- The availability rules here MUST match computeAvailability() in
-- src/lib/availability.ts, including the `<=` on the lead-time boundary. If they
-- drift, the calendar offers dates the server then refuses.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS create_booking_hold(
    date, time, text, text, text, text, text, text, text, numeric, numeric,
    text, text
);
--> statement-breakpoint

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
) RETURNS TABLE (
    error_code      text,
    booking_id      uuid,
    reference       text,
    hold_expires_at timestamptz,
    price_total     integer,
    currency        text
)
LANGUAGE plpgsql AS $$
DECLARE
    v_settings   settings%ROWTYPE;
    v_today      date;
    v_earliest   time;
    v_slot_at    timestamptz;
    v_booking    bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_settings FROM settings WHERE id = 1;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'SETTINGS_MISSING'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    -- ==== LOCK FIRST. Everything below is serialised per date. ============
    PERFORM pg_advisory_xact_lock(4242, booking_date_lock_key(p_booking_date));

    -- Release any lapsed hold on this date, so a dead hold cannot make a free
    -- date look taken (and cannot trip the unique index below).
    PERFORM expire_stale_holds(p_booking_date);

    -- ==== Availability, re-checked under the lock ==========================
    v_today := (now() AT TIME ZONE 'Asia/Qatar')::date;

    IF p_booking_date < v_today THEN
        RETURN QUERY SELECT 'DATE_PAST'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    IF p_booking_date > v_today + v_settings.max_advance_days THEN
        RETURN QUERY SELECT 'DATE_OUT_OF_RANGE'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    -- The requested time must be one the settings row actually offers.
    IF NOT (p_preferred_start::text = ANY (
        SELECT unnest(v_settings.available_start_times)::time::text
    )) THEN
        RETURN QUERY SELECT 'INVALID_START_TIME'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM blackout_dates WHERE date = p_booking_date) THEN
        RETURN QUERY SELECT 'DATE_BLACKOUT'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    -- Lead time, measured from the day's FIRST slot. `<=` matches
    -- computeAvailability: sitting exactly on the boundary is too soon.
    SELECT min(t::time) INTO v_earliest
      FROM unnest(v_settings.available_start_times) AS t;
    v_slot_at := (p_booking_date + v_earliest) AT TIME ZONE 'Asia/Qatar';

    IF v_slot_at <= now() + make_interval(hours => v_settings.lead_time_hours) THEN
        RETURN QUERY SELECT 'DATE_TOO_SOON'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    -- Explicit occupancy check. The unique index would catch this anyway, but
    -- reaching it via a caught exception costs a subtransaction rollback and
    -- loses the ability to distinguish "taken" from a genuine constraint bug.
    IF EXISTS (
        SELECT 1 FROM active_bookings WHERE booking_date = p_booking_date
    ) THEN
        RETURN QUERY SELECT 'DATE_TAKEN'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END IF;

    -- ==== Claim it ========================================================
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
        -- Layer 3. Should be unreachable while the advisory lock holds; if it
        -- fires, the guarantee still held and the customer gets a clean 409.
        RETURN QUERY SELECT 'DATE_TAKEN'::text, NULL::uuid, NULL::text,
                            NULL::timestamptz, NULL::integer, NULL::text;
        RETURN;
    END;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, metadata)
    VALUES (
        v_booking.id, NULL, 'holding', 'customer',
        jsonb_build_object(
            'hold_minutes', v_settings.hold_minutes,
            'hold_expires_at', v_booking.hold_expires_at
        )
    );

    RETURN QUERY SELECT NULL::text, v_booking.id, v_booking.reference,
                        v_booking.hold_expires_at, v_booking.price_total,
                        v_booking.currency;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- expire_stale_holds — now also abandons any payment that was in flight.
--
-- A payment row for a lapsed hold is NOT deleted: it is evidence that money may
-- have been moving, and deleting it would destroy the only record if the gateway
-- later reports a late success. It is marked 'abandoned' and kept.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_stale_holds(p_booking_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_count integer;
BEGIN
    CREATE TEMPORARY TABLE IF NOT EXISTS _expired_holds (id uuid) ON COMMIT DROP;
    DELETE FROM _expired_holds;

    WITH released AS (
        UPDATE bookings
           SET status = 'expired',
               hold_expires_at = NULL,
               updated_at = now()
         WHERE status = 'holding'
           AND hold_expires_at <= now()
           AND (p_booking_date IS NULL OR booking_date = p_booking_date)
        RETURNING id
    )
    INSERT INTO _expired_holds (id) SELECT id FROM released;

    SELECT count(*)::integer INTO v_count FROM _expired_holds;
    IF v_count = 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, metadata)
    SELECT id, 'holding', 'expired', 'system',
           jsonb_build_object('reason', 'hold_lapsed')
      FROM _expired_holds;

    -- Keep the payment row; record that nobody completed it.
    UPDATE payments
       SET status = 'abandoned',
           updated_at = now()
     WHERE booking_id IN (SELECT id FROM _expired_holds)
       AND status = 'initiated';

    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- release_booking_hold — the customer backed out.
--
-- Valid only while the row is 'holding' AND only for the phone that owns it.
-- The phone check is the authorisation: a booking id is a uuid, but it travels
-- through a browser and must not be sufficient on its own to cancel somebody
-- else's hold.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_booking_hold(
    p_booking_id uuid,
    p_phone      text
) RETURNS TABLE (error_code text)
LANGUAGE plpgsql AS $$
DECLARE
    v_status booking_status;
    v_phone  text;
    v_date   date;
BEGIN
    SELECT status, customer_phone, booking_date
      INTO v_status, v_phone, v_date
      FROM bookings
     WHERE id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text;
        RETURN;
    END IF;

    IF v_phone IS DISTINCT FROM p_phone THEN
        -- Deliberately the same code as NOT_FOUND at the API layer, so a
        -- guessed id cannot be used to probe which bookings exist.
        RETURN QUERY SELECT 'FORBIDDEN'::text;
        RETURN;
    END IF;

    IF v_status <> 'holding' THEN
        RETURN QUERY SELECT 'NOT_HOLDING'::text;
        RETURN;
    END IF;

    UPDATE bookings
       SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
     WHERE id = p_booking_id;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, metadata)
    VALUES (p_booking_id, 'holding', 'cancelled', 'customer',
            jsonb_build_object('reason', 'released_by_customer'));

    UPDATE payments
       SET status = 'abandoned', updated_at = now()
     WHERE booking_id = p_booking_id AND status = 'initiated';

    RETURN QUERY SELECT NULL::text;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- Scheduled sweep.
--
-- Belt and braces. The availability view already ignores lapsed holds, so a
-- missed sweep never blocks a customer — but the rows must still be reconciled
-- so the data matches reality and the unique index is freed.
--
-- pg_cron exists on Supabase and generally not on a local Postgres, so this is
-- guarded. Where it is unavailable, schedule POST /api/cron/sweep-holds instead
-- (see the route for the shared-secret check).
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS pg_cron;
            -- Unschedule first so re-running the migration is idempotent.
            PERFORM cron.unschedule('yourwaves-expire-holds')
              WHERE EXISTS (
                SELECT 1 FROM cron.job WHERE jobname = 'yourwaves-expire-holds'
              );
            PERFORM cron.schedule(
                'yourwaves-expire-holds',
                '* * * * *',
                'SELECT expire_stale_holds()'
            );
            RAISE NOTICE 'pg_cron: scheduled yourwaves-expire-holds (every minute)';
        EXCEPTION WHEN OTHERS THEN
            -- Typically insufficient privilege, or pg_cron restricted to the
            -- postgres database. Not fatal: the HTTP sweeper covers it.
            RAISE NOTICE 'pg_cron present but not schedulable (%). Use /api/cron/sweep-holds.', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'pg_cron unavailable. Schedule POST /api/cron/sweep-holds every minute.';
    END IF;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION create_booking_hold(
    date, time, text, text, text, text, text, text, text, numeric, numeric,
    text, text
) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION release_booking_hold(uuid, text) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION booking_date_lock_key(date) FROM PUBLIC;

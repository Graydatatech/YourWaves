-- =========================================================================
-- 0008 — back-office identity, and the RLS that goes with it
--
-- Phases 2-7 had exactly one kind of caller: a trusted server-side connection
-- acting for an anonymous customer. RLS was deny-all and that was enough.
--
-- This phase introduces two AUTHENTICATED kinds of caller — admins and drivers
-- — and with them the first real authorisation question in the project:
-- "which rows may this person see?". That question is answered here, in the
-- database, not in a route handler. A policy holds for every path into the
-- table: the dashboard, a future PostgREST call, a psql session, a bug.
--
-- WHAT THIS DOES NOT DO
-- It does not weaken 0002. `anon` still cannot read anything, and the
-- server-side connection (which owns these tables) is unaffected because 0003
-- removed FORCE. What it adds is the `authenticated` role being able to see
-- SOME rows, decided by a role lookup.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Roles and an auth.uid() that also exists off Supabase
--
--    On Supabase both already exist. On a plain Postgres (the test database)
--    they do not, and without them these policies could not be created — let
--    alone tested. So both are created only when missing, with the SAME
--    semantics Supabase gives them: auth.uid() reads the `sub` claim out of
--    the request's JWT claims GUC.
--
--    That equivalence is what makes tests/admin-rls.test.ts meaningful: it
--    sets `request.jwt.claims` and `ROLE authenticated` exactly as PostgREST
--    would, so the policy being exercised is the policy that will run in
--    production.
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
END;
$$;
--> statement-breakpoint

CREATE SCHEMA IF NOT EXISTS auth;
--> statement-breakpoint

DO $$
BEGIN
    -- Never replace Supabase's own implementation.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'auth' AND p.proname = 'uid'
    ) THEN
        EXECUTE $fn$
            CREATE FUNCTION auth.uid() RETURNS uuid
            LANGUAGE sql STABLE AS $body$
                SELECT NULLIF(
                    current_setting('request.jwt.claims', true)::jsonb->>'sub',
                    ''
                )::uuid;
            $body$;
        $fn$;
    END IF;
END;
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 2. Who is an admin, who is a driver
--
--    A table rather than a JWT claim. A claim would be faster (no lookup) but
--    it is only refreshed when a token is reissued, so revoking someone's
--    access would leave them admin for up to an hour. Here, DELETE means
--    denied on the next query.
--
--    `driver_id` links a login to a row in `drivers`. It is what makes "a
--    driver sees only their own bookings" expressible.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user_roles" (
    "user_id"    uuid PRIMARY KEY,
    "role"       text NOT NULL,
    "driver_id"  uuid REFERENCES "drivers"("id") ON DELETE CASCADE,
    "email"      text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "user_roles_role_check" CHECK (role IN ('admin', 'driver')),
    -- A driver login without a driver row could see nothing and would look
    -- like a broken account rather than a misconfigured one.
    CONSTRAINT "user_roles_driver_needs_driver_id"
        CHECK (role <> 'driver' OR driver_id IS NOT NULL)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_roles_driver_idx"
    ON "user_roles" ("driver_id") WHERE driver_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. The role lookups
--
--    SECURITY DEFINER, and this is the important part: a policy on `bookings`
--    that selected from `user_roles` directly would consult `user_roles`'
--    own policies, which would consult... — infinite recursion, which Postgres
--    reports as a stack depth error at query time rather than at creation.
--    A definer function reads the table with the owner's rights and breaks the
--    cycle.
--
--    `search_path` is pinned. A SECURITY DEFINER function without that is the
--    classic privilege-escalation hole: anyone able to prepend a schema could
--    shadow `user_roles` with their own table.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT role FROM user_roles WHERE user_id = auth.uid();
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
    );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.auth_driver_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT driver_id FROM user_roles
     WHERE user_id = auth.uid() AND role = 'driver';
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_is_admin() TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.auth_driver_id() TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 4. Policies
--
--    Every policy is `TO authenticated`. `anon` is named nowhere, so 0002's
--    deny-all still applies to it in full.
--
--    Drivers get SELECT only, and only on rows assigned to them. Phase 9 gives
--    them a way to advance a job; until something needs it, they cannot write.
-- -------------------------------------------------------------------------

-- user_roles: you may read your own row; only admins see the rest.
DROP POLICY IF EXISTS "user_roles_self_read" ON "user_roles";
--> statement-breakpoint
CREATE POLICY "user_roles_self_read" ON "user_roles"
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "user_roles_admin_write" ON "user_roles";
--> statement-breakpoint
CREATE POLICY "user_roles_admin_write" ON "user_roles"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

-- bookings
DROP POLICY IF EXISTS "bookings_admin_all" ON "bookings";
--> statement-breakpoint
CREATE POLICY "bookings_admin_all" ON "bookings"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "bookings_driver_read_own" ON "bookings";
--> statement-breakpoint
CREATE POLICY "bookings_driver_read_own" ON "bookings"
    FOR SELECT TO authenticated
    USING (
        assigned_driver IS NOT NULL
        AND assigned_driver = auth_driver_id()
    );
--> statement-breakpoint

-- booking_events: admins see everything; a driver sees the history of their
-- own jobs. Still append-only for everyone — the 0001 trigger is unchanged.
DROP POLICY IF EXISTS "booking_events_admin_all" ON "booking_events";
--> statement-breakpoint
CREATE POLICY "booking_events_admin_all" ON "booking_events"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "booking_events_driver_read_own" ON "booking_events";
--> statement-breakpoint
CREATE POLICY "booking_events_driver_read_own" ON "booking_events"
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM bookings b
         WHERE b.id = booking_events.booking_id
           AND b.assigned_driver = auth_driver_id()
    ));
--> statement-breakpoint

-- drivers: admins manage them; a driver may read only their own record.
DROP POLICY IF EXISTS "drivers_admin_all" ON "drivers";
--> statement-breakpoint
CREATE POLICY "drivers_admin_all" ON "drivers"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "drivers_read_self" ON "drivers";
--> statement-breakpoint
CREATE POLICY "drivers_read_self" ON "drivers"
    FOR SELECT TO authenticated
    USING (id = auth_driver_id());
--> statement-breakpoint

-- blackout_dates and settings: admin-only. Drivers have no business here, and
-- customers read both through server routes that use the owner connection.
DROP POLICY IF EXISTS "blackout_dates_admin_all" ON "blackout_dates";
--> statement-breakpoint
CREATE POLICY "blackout_dates_admin_all" ON "blackout_dates"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "settings_admin_all" ON "settings";
--> statement-breakpoint
CREATE POLICY "settings_admin_all" ON "settings"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

-- payments and notifications: ADMIN ONLY, deliberately with no driver policy.
-- A driver has no reason to see what a customer paid or what was messaged to
-- them, and the notifications payload carries the customer's contact details.
DROP POLICY IF EXISTS "payments_admin_all" ON "payments";
--> statement-breakpoint
CREATE POLICY "payments_admin_all" ON "payments"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

DROP POLICY IF EXISTS "notifications_admin_all" ON "notifications";
--> statement-breakpoint
CREATE POLICY "notifications_admin_all" ON "notifications"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

-- otp_verifications is named NOWHERE. It holds code hashes and IP addresses
-- and nothing in the back office needs it; leaving it with no policy keeps it
-- unreadable by any authenticated role.

-- -------------------------------------------------------------------------
-- 5. Table privileges
--
--    RLS filters rows; it does not grant access. `authenticated` needs the
--    GRANT as well, and 0002 revoked everything from it. Granted narrowly:
--    no DELETE anywhere, because nothing in the back office deletes a booking
--    (cancelling is a status change, and booking_events is append-only).
-- -------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
    "bookings", "booking_events", "drivers", "blackout_dates", "settings",
    "payments", "notifications", "user_roles"
    TO authenticated;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 6. Internal notes
--
--    Separate from `booking_events`, which is a machine-written audit trail
--    with an append-only trigger. Notes are human, editable in principle, and
--    must never be mistaken for what the system did. Keeping them apart also
--    means a note can be deleted without punching a hole in the audit log.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "booking_notes" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "author_id"  uuid,
    "author_name" text NOT NULL,
    "body"       text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "booking_notes_body_not_blank" CHECK (btrim(body) <> '')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_notes_booking_idx"
    ON "booking_notes" ("booking_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "booking_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "booking_notes_admin_all" ON "booking_notes";
--> statement-breakpoint
CREATE POLICY "booking_notes_admin_all" ON "booking_notes"
    FOR ALL TO authenticated
    USING (auth_is_admin()) WITH CHECK (auth_is_admin());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_notes" TO authenticated;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 7. Settings changes are audited
--
--    Pricing is the single most consequential field in the system: it decides
--    what every future booking charges. "Who changed the day rate, and when?"
--    must be answerable.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "settings_audit" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "actor_id"   uuid,
    "actor_name" text,
    "before"     jsonb NOT NULL,
    "after"      jsonb NOT NULL,
    "changed_keys" text[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "settings_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "settings_audit_admin_read" ON "settings_audit";
--> statement-breakpoint
CREATE POLICY "settings_audit_admin_read" ON "settings_audit"
    FOR SELECT TO authenticated USING (auth_is_admin());
--> statement-breakpoint

GRANT SELECT ON "settings_audit" TO authenticated;
--> statement-breakpoint

-- An UPDATE/DELETE on the audit table is refused, same as booking_events.
CREATE OR REPLACE FUNCTION settings_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'settings_audit is append-only (attempted %)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "settings_audit_no_mutation" ON "settings_audit";
--> statement-breakpoint

CREATE TRIGGER "settings_audit_no_mutation"
    BEFORE UPDATE OR DELETE ON "settings_audit"
    FOR EACH ROW EXECUTE FUNCTION settings_audit_append_only();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 8. assign_driver — dispatch as one transaction (SRS 3.3)
--
--    Assigning is three writes that must not come apart: the driver on the
--    booking, the status move to 'assigned', and the notifications. The status
--    trigger from 0007 fires the customer and driver messages, so this
--    function does not enqueue them itself.
--
--    REASSIGNMENT notifies the OUTGOING driver too. Someone who has been told
--    to drive to Al Waab at 08:30 must be told when that stops being true;
--    silently reassigning is how two vans arrive, or none.
--
--    Returns a row rather than raising for the expected refusals, following
--    create_booking_hold(): a booking that has already run is not an error.
-- -------------------------------------------------------------------------
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
    v_driver   drivers%ROWTYPE;
    v_previous uuid;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'BOOKING_NOT_FOUND'::text, NULL::uuid, NULL::booking_status;
        RETURN;
    END IF;

    SELECT * INTO v_driver FROM drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'DRIVER_NOT_FOUND'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;
    IF NOT v_driver.is_active THEN
        RETURN QUERY SELECT 'DRIVER_INACTIVE'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;

    -- A completed or cancelled job cannot be dispatched.
    IF v_booking.status NOT IN ('confirmed', 'assigned', 'en_route') THEN
        RETURN QUERY SELECT 'BOOKING_NOT_DISPATCHABLE'::text, NULL::uuid, v_booking.status;
        RETURN;
    END IF;

    v_previous := v_booking.assigned_driver;

    IF v_previous = p_driver_id AND v_booking.status <> 'confirmed' THEN
        RETURN QUERY SELECT 'UNCHANGED'::text, v_previous, v_booking.status;
        RETURN;
    END IF;

    -- The driver first, so the 0007 status trigger sees it and can enqueue the
    -- assignment notification with a driver already attached.
    UPDATE bookings SET assigned_driver = p_driver_id, updated_at = now()
     WHERE id = p_booking_id;

    IF v_booking.status = 'confirmed' THEN
        UPDATE bookings SET status = 'assigned', updated_at = now()
         WHERE id = p_booking_id;
    ELSE
        -- Already assigned or en route: the status does not move, so the
        -- trigger will not fire. Enqueue the new driver's job sheet directly.
        PERFORM enqueue_driver_assignment(p_booking_id);
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
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION assign_driver(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 9. Blackouts may never be laid over a live booking
--
--    The calendar screen lets an admin black out a date. Doing that on top of
--    a confirmed booking would hide a job the crew still has to do, so it is
--    refused here rather than in the UI — the UI is one caller of many.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_blackout_date(
    p_date   date,
    p_reason text,
    p_actor  text DEFAULT NULL
) RETURNS TABLE (outcome text, blackout_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    IF EXISTS (
        SELECT 1 FROM active_bookings WHERE booking_date = p_date
    ) THEN
        RETURN QUERY SELECT 'DATE_HAS_BOOKING'::text, NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO blackout_dates (date, reason, created_by)
    VALUES (p_date, NULLIF(btrim(p_reason), ''), p_actor)
    ON CONFLICT (date) DO UPDATE
        SET reason = EXCLUDED.reason
    RETURNING id INTO v_id;

    RETURN QUERY SELECT 'BLACKED_OUT'::text, v_id;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION add_blackout_date(date, text, text) FROM PUBLIC;

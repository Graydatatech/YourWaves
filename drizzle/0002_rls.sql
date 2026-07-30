-- =========================================================================
-- Row Level Security: deny everything by default.
--
-- The threat model for phase 2 is simple: customers are ANONYMOUS. They never
-- authenticate, and they never read the bookings table directly. Every
-- customer-facing read goes through a Next.js route handler that connects with
-- the service role, so nothing needs to be readable by `anon`.
--
-- With RLS enabled and NO policies defined, `anon` and `authenticated` can do
-- nothing at all. Supabase's `service_role` holds BYPASSRLS and is unaffected.
-- That is exactly the posture we want: any table reachable through PostgREST is
-- sealed until a later phase deliberately opens it.
--
-- Admin policies land in phase 7 (dashboard) and driver policies in phase 9
-- (driver portal). Add them as new migrations; do not loosen this one.
--
-- This file is written to run on BOTH Supabase and a plain Postgres (the test
-- database), so every reference to a Supabase-specific role is guarded.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enable RLS on every table.
--
--    FORCE is deliberate: without it the table OWNER bypasses RLS silently. On
--    Supabase the owner is `postgres`, which several tools connect as, and we
--    would rather those connections be governed by the same rules.
--    `service_role` still bypasses because BYPASSRLS outranks FORCE.
-- -------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'bookings',
        'booking_events',
        'booking_reference_counters',
        'blackout_dates',
        'drivers',
        'otp_verifications',
        'payments',
        'notifications',
        'settings'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 2. Revoke table privileges from the anonymous roles.
--
--    Defence in depth. RLS alone already denies these roles, but removing the
--    GRANT means a future migration that accidentally adds a permissive policy
--    still cannot expose data without an explicit GRANT as well.
--
--    Guarded by a role-existence check so this migration also runs on a plain
--    Postgres instance, where `anon` and `authenticated` do not exist.
-- -------------------------------------------------------------------------
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format(
                'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r
            );
            EXECUTE format(
                'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r
            );
            EXECUTE format(
                'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r
            );
            -- Anything created later is denied to these roles too.
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                'REVOKE ALL ON TABLES FROM %I', r
            );
        END IF;
    END LOOP;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. The booking-mutating functions must not be callable by anonymous users.
--
--    create_booking_hold() and transition_booking_status() are SECURITY INVOKER
--    (the default), so they already run with the caller's privileges and RLS
--    applies. Revoking EXECUTE from PUBLIC makes that explicit rather than
--    incidental: only the service role can call them.
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_booking_hold(
    date, time, text, text, text, text, text, text, text, numeric, numeric,
    text, text
) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION transition_booking_status(
    uuid, booking_status, actor_type, text, jsonb
) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION expire_stale_holds(date) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION next_booking_reference() FROM PUBLIC;

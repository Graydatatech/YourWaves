-- =========================================================================
-- Drop FORCE ROW LEVEL SECURITY, keep ENABLE.
--
-- WHY THIS EXISTS
-- 0002_rls.sql applied both ENABLE and FORCE. FORCE additionally subjects the
-- table OWNER to RLS. That is a sensible instinct in general, but wrong here:
--
--   On Supabase, DATABASE_URL connects as `postgres`, which owns these tables.
--   With FORCE on and zero policies defined, that connection can read nothing.
--   The application would be locked out of its own database.
--
-- It went unnoticed locally because the development machine connects as a
-- Postgres superuser, and superusers bypass RLS unconditionally — the exact
-- kind of false pass that only shows up in the first real deployment.
--
-- SECURITY IS UNCHANGED. The posture that matters is untouched:
--   * RLS remains ENABLED on every table.
--   * There are still no policies, so `anon` and `authenticated` — the roles
--     PostgREST actually uses, neither of which owns anything — can do nothing.
--   * The privilege REVOKEs from 0002 still stand.
--
-- The only behaviour that changes is that the owner (our trusted server-side
-- connection) can query its own tables again. tests/rls.test.ts still proves
-- the denial, because its probe role is not the owner either.
-- =========================================================================
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
        -- Belt and braces: assert RLS itself stays on.
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END;
$$;

-- ===========================================================================
-- 0013 — the two DELETEs the back office actually performs
--
-- 0008 granted `authenticated` SELECT, INSERT and UPDATE across the admin
-- tables and deliberately no DELETE, reasoning that "nothing in the back office
-- deletes a booking". That was true of bookings and is still true — cancelling
-- is a status change, and booking_events is append-only by trigger.
--
-- But two things ARE deleted, and both have been failing since:
--
--   * removing a driver from the dispatch list  (deleteDriver)
--   * lifting a blackout date off the calendar  (removeBlackoutDate)
--
-- The row-level policies already allow it — `dispatch_recipients_admin_all` and
-- `blackout_dates_admin_all` are both FOR ALL — but RLS filters rows, it does
-- not grant table access. Without the GRANT, Postgres refuses before a policy
-- is ever consulted: `permission denied for table dispatch_recipients` (42501),
-- which the UI could only report as "Something went wrong".
--
-- Granted narrowly, table by table. Not `GRANT DELETE ON ALL TABLES`, which
-- would hand `authenticated` the power to delete a payment or a booking_event
-- — rows that are evidence money moved, and that phase 6 and 7 rely on being
-- permanent.
-- ===========================================================================

GRANT DELETE ON "dispatch_recipients" TO authenticated;
--> statement-breakpoint

GRANT DELETE ON "blackout_dates" TO authenticated;

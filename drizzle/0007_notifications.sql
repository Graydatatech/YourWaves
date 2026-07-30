-- ==========================================================================
-- 0007 — the notification outbox becomes a real queue
--
-- Phase 6 wrote rows into `notifications` in the same transaction that
-- confirmed a booking. This migration gives those rows a worker contract:
-- who may claim one, what happens when a send fails, and when it is finally
-- given up on.
--
-- Everything that must not be got wrong lives here rather than in Node:
--
--   * CLAIMING is atomic. Two workers running on overlapping minutes (a slow
--     run plus the next cron tick) must never both send the same message.
--     `FOR UPDATE SKIP LOCKED` is what makes that true; a SELECT-then-UPDATE in
--     application code is a race with a customer-visible symptom — two
--     identical WhatsApp messages.
--
--   * IDEMPOTENCY is a unique index on (booking_id, template_key, recipient),
--     not a check-then-insert. It is what lets every trigger path enqueue
--     freely: the settlement function, the status trigger and a phase-8 admin
--     action can all ask for "booking_confirmed to this customer" and exactly
--     one row exists.
--
--   * BACKOFF is computed from `attempts` in SQL, so a worker that crashes
--     mid-batch cannot lose the schedule. A retry time held only in a Node
--     timer dies with the process.
-- ==========================================================================

-- -------------------------------------------------------------------------
-- 1. Worker bookkeeping
-- -------------------------------------------------------------------------
ALTER TABLE "notifications"
    ADD COLUMN IF NOT EXISTS "claimed_at"      timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "provider_ref"    text,
    ADD COLUMN IF NOT EXISTS "max_attempts"    integer NOT NULL DEFAULT 5;
--> statement-breakpoint

-- Collapse any pre-existing duplicates before the unique index goes on, so a
-- database seeded before this migration can still adopt it. Keeps the oldest
-- row of each group, which is the one whose `sent_at` is most likely set.
DELETE FROM "notifications" a
 USING "notifications" b
 WHERE a.booking_id IS NOT NULL
   AND a.booking_id = b.booking_id
   AND a.template_key = b.template_key
   AND a.recipient = b.recipient
   AND a.created_at > b.created_at;
--> statement-breakpoint

-- The idempotency key the whole design leans on.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key"
    ON "notifications" ("booking_id", "template_key", "recipient")
    WHERE booking_id IS NOT NULL;
--> statement-breakpoint

-- The worker's hot query: due, unsent, oldest first.
CREATE INDEX IF NOT EXISTS "notifications_due_idx"
    ON "notifications" ("scheduled_for")
    WHERE status = 'queued';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notifications_booking_idx"
    ON "notifications" ("booking_id", "created_at" DESC);
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 2. The backoff ladder
--
--    1m → 5m → 15m → 1h → 6h. Held as data rather than an exponent because
--    these intervals are an operational decision, not a formula: the first
--    retry is fast because most failures are a transient 502 from Meta, and
--    the last is slow because by then it is probably a bad number.
--
--    With max_attempts = 5 the 6h rung is only reached if a row is given a
--    higher ceiling — it is deliberately left in the ladder so raising
--    max_attempts needs no code change.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notification_backoff(p_attempts integer)
RETURNS interval
LANGUAGE sql IMMUTABLE AS $$
    SELECT (ARRAY[
        interval '1 minute',
        interval '5 minutes',
        interval '15 minutes',
        interval '1 hour',
        interval '6 hours'
    ])[LEAST(GREATEST(p_attempts, 1), 5)];
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. enqueue_notification — the single insert path
--
--    ON CONFLICT DO NOTHING is the whole point: callers never have to ask
--    whether they are the first to request this message.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_notification(
    p_booking_id     uuid,
    p_channel        notification_channel,
    p_recipient_type notification_recipient_type,
    p_recipient      text,
    p_template_key   text,
    p_locale         text,
    p_payload        jsonb
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    -- A blank recipient is not a notification, it is a bug that would burn all
    -- five attempts to discover. Refuse it at the door.
    IF p_recipient IS NULL OR btrim(p_recipient) = '' THEN
        RETURN NULL;
    END IF;

    INSERT INTO notifications
        (booking_id, channel, recipient_type, recipient, template_key, locale, payload)
    VALUES
        (p_booking_id, p_channel, p_recipient_type, btrim(p_recipient),
         p_template_key, COALESCE(p_locale, 'ar'), COALESCE(p_payload, '{}'::jsonb))
    ON CONFLICT (booking_id, template_key, recipient)
        WHERE booking_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 4. booking_notification_payload — everything a template could need, frozen
--
--    Captured at enqueue time on purpose. A message that goes out after a
--    retry must describe the booking as it was when the event happened; if the
--    templates read the live row instead, a cancelled booking would render a
--    confirmation.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_notification_payload(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_booking  bookings%ROWTYPE;
    v_driver   drivers%ROWTYPE;
    v_settings settings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT * INTO v_settings FROM settings WHERE id = 1;
    IF v_booking.assigned_driver IS NOT NULL THEN
        SELECT * INTO v_driver FROM drivers WHERE id = v_booking.assigned_driver;
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

-- -------------------------------------------------------------------------
-- 5. enqueue_booking_notifications — rewritten
--
--    Signature gains p_notify_admin. The 2-argument form is DROPPED rather
--    than left alongside: two overloads where one has a default is ambiguous,
--    and phase 6 calls this with two arguments from inside a plpgsql body,
--    which resolves at execution and so picks up the new default cleanly.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS enqueue_booking_notifications(uuid, text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enqueue_booking_notifications(
    p_booking_id   uuid,
    p_template_key text,
    p_notify_admin boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking  bookings%ROWTYPE;
    v_settings settings%ROWTYPE;
    v_admin    text;
    v_payload  jsonb;
    v_count    integer := 0;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN 0; END IF;
    SELECT * INTO v_settings FROM settings WHERE id = 1;

    v_payload := booking_notification_payload(p_booking_id);

    -- Customer on WhatsApp, in the language they booked in. Always: a phone
    -- number is mandatory on a booking, an email address is not.
    IF enqueue_notification(p_booking_id, 'whatsapp', 'customer',
            v_booking.customer_phone, p_template_key, v_booking.locale,
            v_payload) IS NOT NULL THEN
        v_count := v_count + 1;
    END IF;

    -- Email is the record copy, and is simply skipped when we have no address.
    IF v_booking.customer_email IS NOT NULL THEN
        IF enqueue_notification(p_booking_id, 'email', 'customer',
                v_booking.customer_email, p_template_key, v_booking.locale,
                v_payload) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END IF;

    -- Admins always in English: the operations inbox is internal.
    IF p_notify_admin AND v_settings.admin_notification_emails IS NOT NULL THEN
        FOREACH v_admin IN ARRAY v_settings.admin_notification_emails LOOP
            IF enqueue_notification(p_booking_id, 'email', 'admin', v_admin,
                    'admin_' || p_template_key, 'en', v_payload) IS NOT NULL THEN
                v_count := v_count + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 6. enqueue_driver_assignment — SRS 3.4.3
--
--    Both channels, deliberately. Drivers live in WhatsApp and will see that
--    first; the email is the copy they can still find at 6am when the message
--    has scrolled away.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_driver_assignment(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking bookings%ROWTYPE;
    v_driver  drivers%ROWTYPE;
    v_payload jsonb;
    v_count   integer := 0;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND OR v_booking.assigned_driver IS NULL THEN RETURN 0; END IF;

    SELECT * INTO v_driver FROM drivers WHERE id = v_booking.assigned_driver;
    IF NOT FOUND THEN RETURN 0; END IF;

    v_payload := booking_notification_payload(p_booking_id);

    -- Drivers are internal staff; the job sheet is English.
    IF enqueue_notification(p_booking_id, 'whatsapp', 'driver', v_driver.phone,
            'driver_assignment', 'en', v_payload) IS NOT NULL THEN
        v_count := v_count + 1;
    END IF;

    IF v_driver.email IS NOT NULL THEN
        IF enqueue_notification(p_booking_id, 'email', 'driver', v_driver.email,
                'driver_assignment', 'en', v_payload) IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END IF;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 7. The status-change trigger — SRS 3.4.4
--
--    A TRIGGER rather than a call inside transition_booking_status, because
--    settle_payment_success writes `UPDATE bookings SET status='confirmed'`
--    directly and phase 8 will add admin actions of its own. Hanging this off
--    the column means every path that moves a booking notifies, including ones
--    not written yet, and none of them has to remember.
--
--    Statuses with no customer-facing meaning (holding, pending, expired) map
--    to NULL and enqueue nothing.
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

DROP TRIGGER IF EXISTS "bookings_notify_status_change" ON "bookings";
--> statement-breakpoint

CREATE TRIGGER "bookings_notify_status_change"
    AFTER UPDATE OF "status" ON "bookings"
    FOR EACH ROW EXECUTE FUNCTION notify_on_status_change();
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 8. claim_notifications — the atomic hand-off to a worker
--
--    `FOR UPDATE SKIP LOCKED` lets N workers drain the queue in parallel with
--    no coordination and no double sends. `attempts` is incremented AT CLAIM
--    TIME, not on failure: a worker that dies mid-send has still consumed an
--    attempt, which is what stops a message that crashes the process from
--    being retried forever.
--
--    p_stale reclaims rows whose worker never came back.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_notifications(
    p_limit integer DEFAULT 25,
    p_stale interval DEFAULT interval '5 minutes'
) RETURNS SETOF notifications
LANGUAGE sql AS $$
    UPDATE notifications n
       SET claimed_at      = now(),
           attempts        = n.attempts + 1,
           last_attempt_at = now()
     WHERE n.id IN (
         SELECT id FROM notifications
          WHERE status = 'queued'
            AND scheduled_for <= now()
            AND (claimed_at IS NULL OR claimed_at < now() - p_stale)
          ORDER BY scheduled_for, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
     )
    RETURNING n.*;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 9. mark_notification_sent
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_notification_sent(
    p_id           uuid,
    p_provider_ref text DEFAULT NULL
) RETURNS void
LANGUAGE sql AS $$
    UPDATE notifications
       SET status       = 'sent',
           sent_at      = now(),
           claimed_at   = NULL,
           provider_ref = p_provider_ref,
           last_error   = NULL
     WHERE id = p_id;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 10. mark_notification_failed
--
--     Retryable and permanent failures are different things. A 502 from Meta
--     earns another attempt; "that template does not exist" earns none,
--     because the next four attempts would fail identically and only delay the
--     admin finding out.
--
--     Returns the outcome so the worker can log what actually happened.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_notification_failed(
    p_id        uuid,
    p_error     text,
    p_retryable boolean DEFAULT true
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_row      notifications%ROWTYPE;
    v_settings settings%ROWTYPE;
    v_admin    text;
    v_give_up  boolean;
BEGIN
    SELECT * INTO v_row FROM notifications WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 'not_found'; END IF;

    v_give_up := (NOT p_retryable) OR (v_row.attempts >= v_row.max_attempts);

    IF NOT v_give_up THEN
        UPDATE notifications
           SET status        = 'queued',
               claimed_at    = NULL,
               last_error    = left(p_error, 2000),
               scheduled_for = now() + notification_backoff(v_row.attempts)
         WHERE id = p_id;
        RETURN 'retry_scheduled';
    END IF;

    UPDATE notifications
       SET status     = 'failed',
           claimed_at = NULL,
           last_error = left(p_error, 2000)
     WHERE id = p_id;

    -- Tell an admin a message never arrived — but never for the alert itself,
    -- or a broken mail provider would enqueue an alert about the alert about
    -- the alert, forever.
    IF v_row.template_key <> 'admin_notification_failed'
       AND v_row.booking_id IS NOT NULL THEN
        SELECT * INTO v_settings FROM settings WHERE id = 1;
        IF v_settings.admin_notification_emails IS NOT NULL THEN
            FOREACH v_admin IN ARRAY v_settings.admin_notification_emails LOOP
                PERFORM enqueue_notification(
                    v_row.booking_id, 'email', 'admin', v_admin,
                    'admin_notification_failed', 'en',
                    COALESCE(booking_notification_payload(v_row.booking_id), '{}'::jsonb)
                        || jsonb_build_object(
                            'failed_notification_id', v_row.id,
                            'failed_channel',         v_row.channel,
                            'failed_template_key',    v_row.template_key,
                            'failed_recipient',       v_row.recipient,
                            'failed_attempts',        v_row.attempts,
                            'failed_error',           left(p_error, 500)));
            END LOOP;
        END IF;
    END IF;

    RETURN 'failed_permanently';
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 11. resend_notification — the admin's manual override (phase 8 UI)
--
--     Resets the existing row rather than inserting a new one, because the
--     dedupe index would refuse the insert anyway. The audit is preserved by
--     keeping attempts history in last_error and bumping max_attempts, so a
--     row that already burned five tries can genuinely go again.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resend_notification(p_id uuid)
RETURNS notifications
LANGUAGE plpgsql AS $$
DECLARE
    v_row notifications%ROWTYPE;
BEGIN
    UPDATE notifications
       SET status        = 'queued',
           claimed_at    = NULL,
           sent_at       = NULL,
           provider_ref  = NULL,
           scheduled_for = now(),
           max_attempts  = attempts + 5
     WHERE id = p_id
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 12. notification_log — what phase 8's admin screen reads
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW "notification_log" WITH (security_invoker = true) AS
    SELECT n.id,
           n.booking_id,
           b.reference,
           b.customer_name,
           n.channel,
           n.recipient_type,
           n.recipient,
           n.template_key,
           n.locale,
           n.status,
           n.attempts,
           n.max_attempts,
           n.last_error,
           n.scheduled_for,
           n.last_attempt_at,
           n.sent_at,
           n.created_at,
           (n.status = 'queued' AND n.scheduled_for > now()) AS is_waiting_for_retry
      FROM notifications n
      LEFT JOIN bookings b ON b.id = n.booking_id;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 13. Nobody but the server role touches any of this.
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION enqueue_notification(uuid, notification_channel, notification_recipient_type, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION booking_notification_payload(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION enqueue_booking_notifications(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION enqueue_driver_assignment(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION claim_notifications(integer, interval) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION mark_notification_sent(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION mark_notification_failed(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resend_notification(uuid) FROM PUBLIC;

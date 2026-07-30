-- =========================================================================
-- Payment settlement (SRS 3.5).
--
-- The webhook is the ONLY thing that confirms a booking. A browser redirect is
-- trivially forgeable — anyone can navigate to the success URL — so the return
-- page never confirms anything; it polls until this SQL has run.
--
-- Everything here is one function call, therefore one transaction: payment
-- status, booking status, hold release, audit row and the notification outbox
-- either all happen or none do. A confirmed booking with no notification queued,
-- or a paid payment against a still-holding booking, are states this makes
-- unreachable.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Idempotency ledger.
--
-- Providers retry. A duplicate confirmation would mean a second set of
-- notifications to the customer at best, and a reconciliation problem at worst.
--
-- The UNIQUE constraint is the mechanism, not a check-then-act in application
-- code: the insert either wins or it does not, atomically, even if two copies of
-- the webhook arrive simultaneously on different connections.
-- -------------------------------------------------------------------------
CREATE TABLE "payment_events" (
    "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider"    text NOT NULL,
    /* The provider's own event/transaction identifier. */
    "event_id"    text NOT NULL,
    "payment_id"  uuid REFERENCES payments(id) ON DELETE SET NULL,
    "outcome"     text,
    "raw"         jsonb,
    "received_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "payment_events_provider_event_key" UNIQUE ("provider", "event_id")
);
--> statement-breakpoint

CREATE INDEX "payment_events_payment_id_idx" ON "payment_events" ("payment_id");
--> statement-breakpoint

ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A payment that succeeded but cannot be honoured (see settle_payment_success).
-- A flag rather than a payment_status value because the payment really IS paid —
-- the refund is a separate action somebody still has to take.
ALTER TABLE "payments"
    ADD COLUMN "refund_required" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "payments" ADD COLUMN "refund_reason" text;
--> statement-breakpoint

CREATE INDEX "payments_refund_required_idx"
    ON "payments" ("refund_required") WHERE refund_required;
--> statement-breakpoint

-- Reconciliation scans for these.
CREATE INDEX "payments_stuck_idx"
    ON "payments" ("status", "created_at") WHERE status = 'initiated';
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- enqueue_booking_notifications — writes outbox rows. Phase 7 sends them.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_booking_notifications(
    p_booking_id   uuid,
    p_template_key text
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_booking  bookings%ROWTYPE;
    v_settings settings%ROWTYPE;
    v_admin    text;
    v_count    integer := 0;
    v_payload  jsonb;
BEGIN
    SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN 0; END IF;
    SELECT * INTO v_settings FROM settings WHERE id = 1;

    -- Everything a template could need, captured NOW. A notification sent later
    -- must describe the booking as it was confirmed.
    v_payload := jsonb_build_object(
        'reference',       v_booking.reference,
        'booking_date',    to_char(v_booking.booking_date, 'YYYY-MM-DD'),
        'preferred_start', to_char(v_booking.preferred_start, 'HH24:MI:SS'),
        'customer_name',   v_booking.customer_name,
        'address_line',    v_booking.address_line,
        'area',            v_booking.area,
        'price_total',     v_booking.price_total,
        'currency',        v_booking.currency
    );

    -- Customer, on WhatsApp, in the language they booked in.
    INSERT INTO notifications
        (booking_id, channel, recipient_type, recipient, template_key, locale, payload)
    VALUES (p_booking_id, 'whatsapp', 'customer', v_booking.customer_phone,
            p_template_key, v_booking.locale, v_payload);
    v_count := v_count + 1;

    IF v_booking.customer_email IS NOT NULL THEN
        INSERT INTO notifications
            (booking_id, channel, recipient_type, recipient, template_key, locale, payload)
        VALUES (p_booking_id, 'email', 'customer', v_booking.customer_email,
                p_template_key, v_booking.locale, v_payload);
        v_count := v_count + 1;
    END IF;

    -- Admins always in English: the operations inbox is internal.
    IF v_settings.admin_notification_emails IS NOT NULL THEN
        FOREACH v_admin IN ARRAY v_settings.admin_notification_emails LOOP
            INSERT INTO notifications
                (booking_id, channel, recipient_type, recipient, template_key, locale, payload)
            VALUES (p_booking_id, 'email', 'admin', v_admin,
                    'admin_' || p_template_key, 'en', v_payload);
            v_count := v_count + 1;
        END LOOP;
    END IF;

    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- settle_payment_success — the only path that confirms a booking.
--
-- Outcomes:
--   duplicate_event   already processed; nothing changed
--   confirmed         the normal path: a live hold became a confirmed booking
--   already_confirmed confirmed by an earlier event
--   revived           the hold had lapsed but the date was still free
--   refund_required   the hold had lapsed AND the date had gone to someone else
--   unknown_payment   no payment row matches this provider reference
--
-- LATE-PAYMENT POLICY (the interesting case)
-- A customer can pay after their 10-minute hold lapses — a slow bank page, 3-D
-- Secure, a dropped connection. Refunding all of those would be wrong: usually
-- nobody else took the date, and the customer would be refunded a booking they
-- successfully paid for and expect to have.
--
-- So: TRY TO REINSTATE. The attempt runs under the per-date advisory lock, and
-- the partial unique index is what actually decides — if another booking now
-- occupies the date the UPDATE raises unique_violation and we fall through to the
-- refund path. Only genuinely unwinnable cases become refunds, and each raises an
-- admin notification because a human has to move the money.
--
-- Webhooks also arrive out of order. A booking already confirmed (or assigned /
-- en route / completed) is never moved backwards.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_payment_success(
    p_provider     text,
    p_provider_ref text,
    p_event_id     text,
    p_amount       integer DEFAULT NULL,
    p_raw          jsonb DEFAULT NULL
) RETURNS TABLE (
    outcome    text,
    booking_id uuid,
    reference  text
)
LANGUAGE plpgsql AS $$
DECLARE
    v_event_id uuid;
    v_payment  payments%ROWTYPE;
    v_booking  bookings%ROWTYPE;
    v_outcome  text;
    v_previous booking_status;
BEGIN
    -- ==== Idempotency, first and atomically ==============================
    INSERT INTO payment_events (provider, event_id, raw)
    VALUES (p_provider, p_event_id, p_raw)
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NULL THEN
        RETURN QUERY SELECT 'duplicate_event'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT * INTO v_payment
      FROM payments
     WHERE provider = p_provider AND provider_ref = p_provider_ref
     FOR UPDATE;

    IF NOT FOUND THEN
        UPDATE payment_events SET outcome = 'unknown_payment' WHERE id = v_event_id;
        RETURN QUERY SELECT 'unknown_payment'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    UPDATE payment_events SET payment_id = v_payment.id WHERE id = v_event_id;

    SELECT * INTO v_booking FROM bookings WHERE id = v_payment.booking_id FOR UPDATE;
    IF NOT FOUND THEN
        UPDATE payment_events SET outcome = 'unknown_payment' WHERE id = v_event_id;
        RETURN QUERY SELECT 'unknown_payment'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    v_previous := v_booking.status;

    -- Serialise against anyone else acting on this date.
    PERFORM pg_advisory_xact_lock(4242, booking_date_lock_key(v_booking.booking_date));

    -- ==== Already settled forwards: never regress ========================
    IF v_booking.status IN ('confirmed','assigned','en_route','completed') THEN
        UPDATE payments
           SET status = 'paid', raw_payload = COALESCE(p_raw, raw_payload),
               updated_at = now()
         WHERE id = v_payment.id;
        UPDATE payment_events SET outcome = 'already_confirmed' WHERE id = v_event_id;
        RETURN QUERY SELECT 'already_confirmed'::text, v_booking.id, v_booking.reference;
        RETURN;
    END IF;

    -- ==== Normal path: a live hold ========================================
    IF v_booking.status = 'holding'
       AND v_booking.hold_expires_at IS NOT NULL
       AND v_booking.hold_expires_at > now() THEN

        UPDATE bookings
           SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
         WHERE id = v_booking.id;

        INSERT INTO booking_events
            (booking_id, from_status, to_status, actor_type, metadata)
        VALUES (v_booking.id, 'holding', 'confirmed', 'system',
                jsonb_build_object('reason','payment_succeeded',
                                   'provider',p_provider,
                                   'provider_ref',p_provider_ref));
        v_outcome := 'confirmed';

    ELSE
        -- ==== Late payment: hold lapsed (or was released) =================
        BEGIN
            UPDATE bookings
               SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
             WHERE id = v_booking.id;

            INSERT INTO booking_events
                (booking_id, from_status, to_status, actor_type, metadata)
            VALUES (v_booking.id, v_previous, 'confirmed', 'system',
                    jsonb_build_object('reason','late_payment_revived',
                                       'previous_status',v_previous,
                                       'provider',p_provider,
                                       'provider_ref',p_provider_ref));
            v_outcome := 'revived';
        EXCEPTION WHEN unique_violation THEN
            -- The date went to someone else. The money is ours and must go back.
            v_outcome := 'refund_required';
        END;
    END IF;

    -- ==== Record the payment =============================================
    IF v_outcome = 'refund_required' THEN
        UPDATE payments
           SET status = 'paid',
               refund_required = true,
               refund_reason = 'hold_expired_and_date_reallocated',
               raw_payload = COALESCE(p_raw, raw_payload),
               updated_at = now()
         WHERE id = v_payment.id;

        INSERT INTO booking_events
            (booking_id, from_status, to_status, actor_type, metadata)
        VALUES (v_booking.id, v_previous, v_previous, 'system',
                jsonb_build_object('reason','payment_needs_refund',
                                   'provider',p_provider,
                                   'provider_ref',p_provider_ref,
                                   'amount', v_payment.amount));

        -- A human has to move the money, so this is an admin alert.
        PERFORM enqueue_booking_notifications(v_booking.id, 'payment_refund_required');
    ELSE
        UPDATE payments
           SET status = 'paid', raw_payload = COALESCE(p_raw, raw_payload),
               updated_at = now()
         WHERE id = v_payment.id;

        PERFORM enqueue_booking_notifications(v_booking.id, 'booking_confirmed');
    END IF;

    -- A mismatch is not grounds to refuse a payment the provider already took;
    -- it is grounds to tell somebody. Recorded for reconciliation.
    IF p_amount IS NOT NULL AND p_amount <> v_payment.amount THEN
        INSERT INTO booking_events
            (booking_id, from_status, to_status, actor_type, metadata)
        VALUES (v_booking.id, v_previous, v_previous, 'system',
                jsonb_build_object('reason','amount_mismatch',
                                   'expected', v_payment.amount,
                                   'received', p_amount));
    END IF;

    UPDATE payment_events SET outcome = v_outcome WHERE id = v_event_id;

    SELECT * INTO v_booking FROM bookings WHERE id = v_payment.booking_id;
    RETURN QUERY SELECT v_outcome, v_booking.id, v_booking.reference;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- settle_payment_failure — declined or cancelled.
--
-- The booking deliberately STAYS 'holding' until its natural expiry. The
-- customer still has minutes on the clock, and the commonest next action after a
-- declined card is trying another one; releasing the date immediately would hand
-- it to somebody else while they reached for their wallet.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_payment_failure(
    p_provider     text,
    p_provider_ref text,
    p_event_id     text,
    p_raw          jsonb DEFAULT NULL
) RETURNS TABLE (
    outcome    text,
    booking_id uuid,
    reference  text
)
LANGUAGE plpgsql AS $$
DECLARE
    v_event_id uuid;
    v_payment  payments%ROWTYPE;
    v_booking  bookings%ROWTYPE;
BEGIN
    INSERT INTO payment_events (provider, event_id, raw)
    VALUES (p_provider, p_event_id, p_raw)
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NULL THEN
        RETURN QUERY SELECT 'duplicate_event'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT * INTO v_payment
      FROM payments
     WHERE provider = p_provider AND provider_ref = p_provider_ref
     FOR UPDATE;

    IF NOT FOUND THEN
        UPDATE payment_events SET outcome = 'unknown_payment' WHERE id = v_event_id;
        RETURN QUERY SELECT 'unknown_payment'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT * INTO v_booking FROM bookings WHERE id = v_payment.booking_id;

    -- A failure arriving after a success (out-of-order delivery) must not undo
    -- the confirmation or the payment.
    IF v_payment.status = 'paid'
       OR v_booking.status IN ('confirmed','assigned','en_route','completed') THEN
        UPDATE payment_events
           SET outcome = 'ignored_after_success', payment_id = v_payment.id
         WHERE id = v_event_id;
        RETURN QUERY SELECT 'ignored_after_success'::text, v_booking.id, v_booking.reference;
        RETURN;
    END IF;

    UPDATE payments
       SET status = 'failed', raw_payload = COALESCE(p_raw, raw_payload),
           updated_at = now()
     WHERE id = v_payment.id;

    INSERT INTO booking_events
        (booking_id, from_status, to_status, actor_type, metadata)
    VALUES (v_booking.id, v_booking.status, v_booking.status, 'system',
            jsonb_build_object('reason','payment_failed',
                               'provider',p_provider,
                               'provider_ref',p_provider_ref));

    UPDATE payment_events
       SET outcome = 'failed_hold_kept', payment_id = v_payment.id
     WHERE id = v_event_id;

    RETURN QUERY SELECT 'failed_hold_kept'::text, v_booking.id, v_booking.reference;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- payments_needing_reconciliation — stuck in 'initiated' past a grace period.
--
-- A payment sits in 'initiated' when the customer abandoned the hosted page OR
-- when the webhook never arrived. Only the provider can tell those apart, which
-- is what the reconciliation job calls fetchStatus for.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payments_needing_reconciliation(
    p_older_than interval DEFAULT interval '30 minutes',
    p_limit      integer DEFAULT 50
) RETURNS TABLE (
    payment_id   uuid,
    provider     text,
    provider_ref text,
    booking_id   uuid,
    amount       integer,
    created_at   timestamptz
)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.provider, p.provider_ref, p.booking_id, p.amount, p.created_at
      FROM payments p
     WHERE p.status = 'initiated'
       AND p.provider_ref IS NOT NULL
       AND p.created_at < now() - p_older_than
     ORDER BY p.created_at
     LIMIT p_limit
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION settle_payment_success(text, text, text, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION settle_payment_failure(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION enqueue_booking_notifications(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION payments_needing_reconciliation(interval, integer) FROM PUBLIC;

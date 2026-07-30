-- =========================================================================
-- OTP issuance: rate limits and atomic code allocation (SRS 3.5).
--
-- WHY THIS IS SQL AND NOT APPLICATION CODE
-- Every limit here is a read-then-write. Checked in Node, two requests that
-- arrive together both read "0 sends in the last minute" and both proceed — the
-- limit silently becomes "1 per 60s per phone, per concurrent request". Doing
-- the check and the insert in one function under a per-phone advisory lock
-- makes the count that was read the count that is acted on.
--
-- No separate counter table: otp_verifications already records phone, ip and
-- created_at, which is exactly the history every limit needs. That also means a
-- superseded code still counts towards the caps — invalidation marks rows
-- expired rather than deleting them, so a customer cannot reset their own quota
-- by asking for another code.
-- =========================================================================

-- Indexes for the four limit queries. Without these every send seq-scans the
-- whole table.
CREATE INDEX "otp_verifications_phone_created_idx"
    ON "otp_verifications" ("phone", "created_at" DESC);
--> statement-breakpoint

CREATE INDEX "otp_verifications_ip_created_idx"
    ON "otp_verifications" ("ip", "created_at" DESC);
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- request_otp — allocate a code slot, or say why not.
--
-- Returns (allowed, reason, retry_after, otp_id). `retry_after` is whole
-- seconds and is what the endpoint puts in its 429 response, so the client can
-- show a real countdown instead of "try again later".
--
-- Limits, in the order a customer is most likely to meet them:
--   per_phone_cooldown   1 send  per 60 seconds per phone
--   per_phone_hourly     5 sends per hour       per phone
--   per_ip_hourly       20 sends per hour       per IP
--   per_ip_phones        3 distinct phones per hour per IP
--
-- The IP limits are the second-order defence: they are what stops one host
-- walking a range of numbers. `ip` may be NULL when it cannot be determined, in
-- which case the IP limits are skipped rather than applied to a single NULL
-- bucket shared by every such request.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_otp(
    p_phone       text,
    p_code_hash   text,
    p_ip          inet,
    p_ttl_seconds integer DEFAULT 300
) RETURNS TABLE (
    allowed     boolean,
    reason      text,
    retry_after integer,
    otp_id      uuid
)
LANGUAGE plpgsql AS $$
DECLARE
    v_last_at        timestamptz;
    v_phone_count    integer;
    v_ip_count       integer;
    v_ip_phones      integer;
    v_oldest_in_hour timestamptz;
    v_retry          integer;
    v_id             uuid;
BEGIN
    -- Serialise concurrent requests for the SAME phone. Transaction-scoped, so
    -- it is released on commit or rollback with no cleanup path to forget.
    PERFORM pg_advisory_xact_lock(hashtext('yourwaves:otp:' || p_phone));

    -- --- 1. one send per 60s per phone ----------------------------------
    SELECT max(created_at) INTO v_last_at
      FROM otp_verifications
     WHERE phone = p_phone;

    IF v_last_at IS NOT NULL AND v_last_at > now() - interval '60 seconds' THEN
        v_retry := ceil(60 - extract(epoch FROM (now() - v_last_at)))::integer;
        RETURN QUERY
            SELECT false, 'per_phone_cooldown', greatest(v_retry, 1), NULL::uuid;
        RETURN;
    END IF;

    -- --- 2. five sends per hour per phone -------------------------------
    SELECT count(*), min(created_at)
      INTO v_phone_count, v_oldest_in_hour
      FROM otp_verifications
     WHERE phone = p_phone
       AND created_at > now() - interval '1 hour';

    IF v_phone_count >= 5 THEN
        -- Available again when the oldest send in the window ages out.
        v_retry := ceil(
            extract(epoch FROM (v_oldest_in_hour + interval '1 hour' - now()))
        )::integer;
        RETURN QUERY
            SELECT false, 'per_phone_hourly', greatest(v_retry, 1), NULL::uuid;
        RETURN;
    END IF;

    -- --- 3 & 4. IP limits (skipped when the IP is unknown) ---------------
    IF p_ip IS NOT NULL THEN
        SELECT count(*), min(created_at)
          INTO v_ip_count, v_oldest_in_hour
          FROM otp_verifications
         WHERE ip = p_ip
           AND created_at > now() - interval '1 hour';

        IF v_ip_count >= 20 THEN
            v_retry := ceil(
                extract(epoch FROM (v_oldest_in_hour + interval '1 hour' - now()))
            )::integer;
            RETURN QUERY
                SELECT false, 'per_ip_hourly', greatest(v_retry, 1), NULL::uuid;
            RETURN;
        END IF;

        -- Distinct OTHER phones. A host retrying a number it has already used is
        -- not broadening its reach, so it is not counted again.
        SELECT count(DISTINCT phone) INTO v_ip_phones
          FROM otp_verifications
         WHERE ip = p_ip
           AND created_at > now() - interval '1 hour'
           AND phone <> p_phone;

        IF v_ip_phones >= 3 THEN
            RETURN QUERY SELECT false, 'per_ip_phones', 3600, NULL::uuid;
            RETURN;
        END IF;
    END IF;

    -- --- Invalidate any previous live code for this phone ----------------
    -- Expire rather than delete: the row is history the limits above depend on.
    UPDATE otp_verifications
       SET expires_at = now()
     WHERE phone = p_phone
       AND consumed_at IS NULL
       AND expires_at > now();

    -- --- Issue ----------------------------------------------------------
    INSERT INTO otp_verifications (phone, code_hash, expires_at, ip)
    VALUES (
        p_phone,
        p_code_hash,
        now() + make_interval(secs => p_ttl_seconds),
        p_ip
    )
    RETURNING id INTO v_id;

    RETURN QUERY SELECT true, 'ok', 0, v_id;
END;
$$;
--> statement-breakpoint

-- -------------------------------------------------------------------------
-- Housekeeping. Nothing older than an hour affects a rate limit, and retaining
-- verification history indefinitely means retaining a list of customer phone
-- numbers we have no further use for.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_old_otps(
    p_older_than interval DEFAULT interval '24 hours'
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_count integer;
BEGIN
    DELETE FROM otp_verifications WHERE created_at < now() - p_older_than;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
--> statement-breakpoint

-- Consistent with 0002: service-role only.
REVOKE EXECUTE ON FUNCTION request_otp(text, text, inet, integer) FROM PUBLIC;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION purge_old_otps(interval) FROM PUBLIC;

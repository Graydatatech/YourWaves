-- ===========================================================================
-- 0011 — proof-of-completion photos from the job sheet
--
-- "Job complete" may carry a photo of the finished setup. It is OPTIONAL and
-- it is evidence: the office settles a dispute about whether the wave was
-- delivered and left tidy by looking at it, months later.
--
-- Stored as bytes in Postgres rather than in object storage, deliberately.
-- Supabase Storage would be the obvious home, but no bucket is provisioned and
-- provisioning is the client's to do — the same gap that already blocks
-- SkipCash, Resend and the WhatsApp Cloud API. A photo path that depends on an
-- unprovisioned service would silently drop the driver's evidence, whereas the
-- database is already there and already backed up. The client compresses to a
-- long edge of 1600px, so a photo lands at roughly 150-300KB; the CHECK caps it
-- at 2MiB so a mis-built client cannot fill the disk one upload at a time.
--
-- Idempotent by `client_action_id`, the SAME key the offline action queue uses.
-- A driver on the edge of coverage retries the upload; the unique constraint
-- means the photo is stored once no matter how many times it is replayed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "booking_dispatch_photos" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "dispatch_id"      uuid NOT NULL REFERENCES "booking_dispatch"("id") ON DELETE CASCADE,
    "booking_id"       uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
    "client_action_id" text NOT NULL,
    "mime_type"        text NOT NULL,
    "byte_size"        integer NOT NULL,
    "image"            bytea NOT NULL,
    "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "booking_dispatch_photos_idem_key"
        UNIQUE (dispatch_id, client_action_id),
    CONSTRAINT "booking_dispatch_photos_size_check"
        CHECK (byte_size > 0 AND byte_size <= 2097152),
    -- Only formats a browser will render inline. An SVG is a script delivery
    -- mechanism and is not in this list on purpose.
    CONSTRAINT "booking_dispatch_photos_mime_check"
        CHECK (mime_type IN ('image/jpeg', 'image/webp', 'image/png'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_dispatch_photos_booking_idx"
    ON "booking_dispatch_photos" ("booking_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "booking_dispatch_photos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "booking_dispatch_photos_admin_read" ON "booking_dispatch_photos";
--> statement-breakpoint

-- Read-only even for an admin: a photo is an audit record, so it is written
-- once by the recipient who took it and never edited afterwards.
CREATE POLICY "booking_dispatch_photos_admin_read" ON "booking_dispatch_photos"
    FOR SELECT TO authenticated USING (auth_is_admin());
--> statement-breakpoint

GRANT SELECT ON "booking_dispatch_photos" TO authenticated;

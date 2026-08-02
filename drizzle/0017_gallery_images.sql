-- ---------------------------------------------------------------------------
-- Editable gallery.
--
-- A jsonb ARRAY of { path, altEn, altAr }, in display order — the same shape
-- decision as `faq`: a list whose length the admin controls.
--
-- `path` is the object path INSIDE the Supabase Storage bucket, not a full URL.
-- Storing the URL would bake the project reference into every row, so a restore
-- into a different Supabase project, or a custom storage domain later, would
-- break every image with no way to fix it but a data migration. The public URL
-- is derived at render from NEXT_PUBLIC_SUPABASE_URL.
--
-- The BYTES live in Storage, not here. That is the opposite of the dispatch
-- completion photos (§4i), and deliberately: those are evidence, written once
-- from a driveway and read by one admin, where a 2MiB bytea and no provisioning
-- was the right trade. These are public marketing images on the LCP path,
-- fetched by every visitor — they need a CDN and next/image, and Postgres is
-- the wrong place for six of them multiplied by everyone who visits.
--
-- Empty falls back to the placeholder art committed in public/media, so an
-- untouched deployment renders the designed gallery and deleting every image
-- restores it rather than leaving a hole in the page.
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "gallery" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "settings"."gallery" IS
    'Ordered [{path, altEn, altAr}]. `path` is the object path inside the Supabase Storage gallery bucket, never a full URL. Empty falls back to public/media placeholder art.';

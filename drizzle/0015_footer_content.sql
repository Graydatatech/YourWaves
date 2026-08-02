-- ---------------------------------------------------------------------------
-- Editable footer content.
--
-- ONE jsonb column, not nine text ones. The footer is a cohesive block of
-- presentation copy rather than nine independent settings, and nine columns
-- would mean nine entries in SETTINGS_COLUMNS, nine zod fields and nine
-- migrations the next time the design changes. `service_areas` set the
-- precedent for structured settings living in jsonb.
--
-- The double-encoding trap §4h records applies here: a pre-stringified value
-- handed to a `::jsonb` cast is encoded TWICE and lands as a jsonb STRING,
-- after which `->>` returns NULL for every key. `updateSettings` already routes
-- jsonb columns through `::text::jsonb` for exactly this reason —
-- JSONB_SETTINGS_COLUMNS is what makes that happen, and `footer` must be in it.
--
-- DEFAULT '{}' rather than seeded copy. An empty object means "nothing has been
-- customised", and the site falls back to the strings in messages/*.json — so
-- an untouched deployment renders the designed footer rather than blanks, and
-- clearing a field in the back office restores the default rather than emptying
-- the page.
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "footer" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "settings"."footer" IS
    'Footer content overrides: taglineEn/Ar, email, phone, citiesEn/Ar, instagram, whatsapp, youtube. Any key absent or empty falls back to messages/*.json.';

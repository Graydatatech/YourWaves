-- ---------------------------------------------------------------------------
-- Terms & conditions, editable from the back office.
--
-- Stored on `settings` rather than in a `terms` table with revisions. One row,
-- two languages, replaced in place — because that is what the business asked
-- for and a revision history nobody reads is a table to migrate later for
-- nothing. `settings_audit` already records every change to this table with a
-- full before/after snapshot, so the previous wording IS recoverable; it just
-- lives in the audit trail rather than in a column.
--
-- BILINGUAL, in two plain text columns rather than one jsonb. `service_areas`
-- is jsonb because it is a LIST of pairs; this is a single pair, and two
-- columns keep it greppable, indexable and free of the double-encoding trap
-- that jsonb parameters carry (§4h).
--
-- NOT NULL DEFAULT '' rather than nullable: "no terms yet" and "terms set to
-- an empty string" are the same state to every reader, and a nullable column
-- would mean every consumer handling both.
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "terms_en" text NOT NULL DEFAULT '';
--> statement-breakpoint

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "terms_ar" text NOT NULL DEFAULT '';
--> statement-breakpoint

COMMENT ON COLUMN "settings"."terms_en" IS
    'Terms and conditions, English. Plain text; rendered paragraph-per-blank-line. Empty means the booking form shows no agreement tick.';
--> statement-breakpoint

COMMENT ON COLUMN "settings"."terms_ar" IS
    'Terms and conditions, Arabic. Empty falls back to the English text rather than showing nothing.';

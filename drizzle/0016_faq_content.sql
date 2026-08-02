-- ---------------------------------------------------------------------------
-- Editable FAQ.
--
-- A jsonb ARRAY, because unlike the footer this is a list whose length the
-- admin controls — the same reason `service_areas` is jsonb rather than paired
-- columns. Shape: [{ questionEn, questionAr, answerEn, answerAr }], in display
-- order, which is array order.
--
-- The `::text::jsonb` trap from §4h applies exactly as it does to
-- `service_areas` and `footer`: `faq` must be in JSONB_SETTINGS_COLUMNS or the
-- value is encoded twice and lands as a jsonb string.
--
-- DEFAULT '[]' means "not customised", and the site falls back to the five
-- questions in messages/*.json. An admin who deletes every row gets the
-- designed FAQ back rather than an empty section — the same restore-by-clearing
-- behaviour as the footer, and for the same reason: a section with nothing in
-- it looks broken.
--
-- This feeds the FAQPage JSON-LD as well as the accordion, so the structured
-- data and the visible page cannot describe different questions.
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "faq" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "settings"."faq" IS
    'Ordered [{questionEn, questionAr, answerEn, answerAr}]. Empty array falls back to the questions in messages/*.json.';

-- ---------------------------------------------------------------------------
-- 0021 — a published review can carry the admin's translation.
--
-- A review is written in whatever language the customer booked in, and the
-- site is bilingual. Until now every published review was shown on BOTH pages
-- verbatim, so an Arabic testimonial appeared untranslated under "What guests
-- say" on the English page — which reads as a broken site rather than as an
-- authentic quote.
--
-- `comment` stays exactly as the customer wrote it and is never edited. It is
-- their words, and the moderation decision an admin made was about that text;
-- silently rewriting it in place would make "published" mean something else.
-- The translation is a SEPARATE column, so the original and the rendering are
-- both recoverable and it is always clear which is which.
--
-- WHICH SITE A REVIEW APPEARS ON:
--   its own language          — always, from `comment`
--   the other language        — only once comment_translation is filled in
--
-- A review with no translation is therefore live on one site and absent from
-- the other. That is deliberate: the alternative is showing Arabic prose to an
-- English reader, and an admin who has published something can see in the back
-- office exactly where it is showing.
-- ---------------------------------------------------------------------------

ALTER TABLE "reviews"
    ADD COLUMN IF NOT EXISTS "comment_translation" text;
--> statement-breakpoint

COMMENT ON COLUMN "reviews"."comment_translation" IS
    'The admin''s rendering of `comment` in the OTHER language — English when locale is ar, Arabic when locale is en. NULL means the review shows only on its own language''s site.';
--> statement-breakpoint

COMMENT ON COLUMN "reviews"."comment" IS
    'Exactly what the customer wrote, in the language named by `locale`. Never edited: it is the text an admin approved when they published it.';

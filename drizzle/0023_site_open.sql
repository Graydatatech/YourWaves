-- ---------------------------------------------------------------------------
-- 0023 — opening the site is a button, not a redeploy.
--
-- Until now the pre-launch gate had one switch: the SITE_PASSWORD environment
-- variable. Launching meant editing the deployment and redeploying, which is a
-- developer's job on a day the client wants to do it themselves.
--
-- `site_open` sits ON TOP of that variable rather than replacing it:
--   SITE_PASSWORD unset          → the site is public, this column is ignored
--   SITE_PASSWORD set, false     → the gate asks for the password (as before)
--   SITE_PASSWORD set, true      → the gate stands aside; the site is public
--
-- So the password itself never enters the database, and the admin button can
-- open and re-close the site without anyone knowing or changing it.
--
-- DEFAULT false: applying this migration changes nothing. A locked site stays
-- locked until somebody presses the button.
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "site_open" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

COMMENT ON COLUMN "settings"."site_open" IS
    'true = the pre-launch password gate stands aside. Only consulted while SITE_PASSWORD is set; with it unset the site is public regardless.';

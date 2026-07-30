-- =========================================================================
-- 0009 — a driver is identified by their phone number
--
-- Drivers live in WhatsApp: the job sheet, the arrival time and the maps link
-- all reach them on their number, and phase 7 sends the email copy only when
-- one happens to exist. So the number is the identity, and the back office adds
-- a driver by number rather than by email.
--
-- That makes a duplicate number a real operational fault rather than untidy
-- data: two driver rows sharing a number means one person receives two job
-- sheets and the dispatcher cannot tell which assignment is live. Enforced here
-- rather than in the form, because the form is one caller of many.
-- =========================================================================

-- Any pre-existing duplicate would make the index creation fail, so collapse
-- them first: keep the oldest row of each number and repoint any bookings that
-- referenced the ones being removed. Reassigning is safe — the rows are the
-- same person by definition.
DO $$
DECLARE
    dup RECORD;
BEGIN
    FOR dup IN
        SELECT phone, min(created_at) AS keep_created
          FROM drivers GROUP BY phone HAVING count(*) > 1
    LOOP
        UPDATE bookings b
           SET assigned_driver = (
                 SELECT id FROM drivers
                  WHERE phone = dup.phone ORDER BY created_at LIMIT 1
               )
         WHERE b.assigned_driver IN (
                 SELECT id FROM drivers
                  WHERE phone = dup.phone AND created_at > dup.keep_created
               );

        DELETE FROM drivers
         WHERE phone = dup.phone AND created_at > dup.keep_created;
    END LOOP;
END;
$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "drivers_phone_key" ON "drivers" ("phone");

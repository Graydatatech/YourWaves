-- ===========================================================================
-- 0012 — one full-day price, and service areas that have an Arabic name
--
-- TWO changes, both driven by how the business actually sells:
--
-- 1. PRICING. The brief split the day rate into rental + setup + delivery.
--    The client sells ONE full-day price, so the split is now noise: three
--    boxes in the back office where a mistake in any of them changes what a
--    customer pays, and three lines on a quote that all describe the same day.
--
--    The columns STAY. `price_total = rental + setup + delivery` is a CHECK
--    constraint on every booking row ever written, and dropping the columns
--    would rewrite history to make old bookings look like they were priced
--    differently. Instead setup and delivery go to zero and the whole price
--    lives in `price_rental`.
--
--    The existing amounts are FOLDED IN rather than discarded: 4500 + 600 +
--    350 becomes a 5450 full-day rate, so no customer sees a price change on
--    the day this ships. Lowering the price is a business decision, not a
--    side effect of a schema migration.
--
-- 2. SERVICE AREAS. `text[]` could only hold one spelling, so an Arabic
--    customer picked their own neighbourhood off an English chip. Now a jsonb
--    array of {en, ar}. The ENGLISH name stays the canonical value written to
--    `bookings.area`: the back office is English-only (§4h) and so is every
--    dispatch job sheet a driver reads, so one spelling has to be the one ops
--    sees, and it cannot be the one that changes with the customer's locale.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Fold the price split into a single full-day rate
-- --------------------------------------------------------------------------
UPDATE "settings"
   SET price_rental  = price_rental + price_setup + price_delivery,
       price_setup   = 0,
       price_delivery = 0,
       updated_at    = now()
 WHERE price_setup <> 0 OR price_delivery <> 0;
--> statement-breakpoint

-- --------------------------------------------------------------------------
-- 2. service_areas: text[] → jsonb [{en, ar}]
--
--    Existing rows are converted rather than dropped. The six seeded Qatari
--    areas get their real Arabic names here so a live project is bilingual
--    the moment this runs, without waiting for someone to retype them in the
--    back office. Anything else keeps the English spelling in both fields —
--    visible, editable, and obviously unfinished rather than silently blank.
-- --------------------------------------------------------------------------
ALTER TABLE "settings"
    ADD COLUMN IF NOT EXISTS "service_areas_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

UPDATE "settings" s
   SET service_areas_json = COALESCE(
       (SELECT jsonb_agg(
                 jsonb_build_object(
                   'en', name,
                   'ar', CASE name
                           WHEN 'Doha'      THEN 'الدوحة'
                           WHEN 'Lusail'    THEN 'لوسيل'
                           WHEN 'Al Wakrah' THEN 'الوكرة'
                           WHEN 'Al Khor'   THEN 'الخور'
                           WHEN 'West Bay'  THEN 'الخليج الغربي'
                           WHEN 'Al Rayyan' THEN 'الريان'
                           WHEN 'Al Waab'   THEN 'الوعب'
                           WHEN 'Umm Salal' THEN 'أم صلال'
                           WHEN 'Mesaieed'  THEN 'مسيعيد'
                           WHEN 'Al Sadd'   THEN 'السد'
                           WHEN 'The Pearl' THEN 'اللؤلؤة'
                           ELSE name
                         END))
          FROM unnest(s.service_areas) AS name),
       '[]'::jsonb);
--> statement-breakpoint

ALTER TABLE "settings" DROP COLUMN IF EXISTS "service_areas";
--> statement-breakpoint

ALTER TABLE "settings" RENAME COLUMN "service_areas_json" TO "service_areas";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testSql } from "./helpers/db";
import { updateSettings } from "@/lib/admin/mutations";
import { getAdminSettings } from "@/lib/admin/queries";
import type { AdminSession } from "@/lib/admin/session";

/**
 * Writing settings through the REAL back-office path.
 *
 * `service_areas` became jsonb in migration 0012, and jsonb is where this
 * project has been bitten before: postgres.js serialises the parameter itself
 * when it sees a `::jsonb` cast, so a pre-stringified value is encoded twice
 * and lands as a jsonb STRING — after which every key reads back NULL and
 * nothing complains (§4h). A test that only checked the array round-tripped
 * through TypeScript would pass while the column held garbage, so this one
 * asks POSTGRES what shape it stored.
 */

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const session: AdminSession = {
  userId: ADMIN_ID,
  email: "settings@yourwaves.qa",
  role: "admin",
  displayName: "Settings Test",
};

let original: unknown;

beforeAll(async () => {
  await testSql`DELETE FROM user_roles WHERE user_id = ${ADMIN_ID}::uuid`;
  await testSql`
    INSERT INTO user_roles (user_id, role, email)
    VALUES (${ADMIN_ID}::uuid, 'admin', 'settings@yourwaves.qa')
  `;
  const [row] = await testSql<{ service_areas: unknown }[]>`
    SELECT service_areas FROM settings WHERE id = 1
  `;
  original = row.service_areas;
});

afterAll(async () => {
  await testSql`
    UPDATE settings SET service_areas = ${JSON.stringify(original)}::text::jsonb
     WHERE id = 1
  `;
  await testSql`DELETE FROM user_roles WHERE user_id = ${ADMIN_ID}::uuid`;
});

describe("bilingual service areas", () => {
  it("are stored as jsonb OBJECTS, not as a doubly-encoded string", async () => {
    await updateSettings(session, {
      serviceAreas: [
        { en: "Al Wakrah", ar: "الوكرة" },
        { en: "Lusail", ar: "لوسيل" },
      ],
    });

    // Ask the database what it holds. `->>` returning the Arabic name is the
    // assertion that matters: on a double-encoded value it returns NULL.
    const [row] = await testSql<
      {
        kind: string;
        first_en: string | null;
        first_ar: string | null;
        count: number;
      }[]
    >`
      SELECT jsonb_typeof(service_areas) AS kind,
             service_areas->0->>'en' AS first_en,
             service_areas->0->>'ar' AS first_ar,
             jsonb_array_length(service_areas)::int AS count
        FROM settings WHERE id = 1
    `;

    expect(row.kind).toBe("array");
    expect(row.count).toBe(2);
    expect(row.first_en).toBe("Al Wakrah");
    expect(row.first_ar).toBe("الوكرة");
  });

  it("read back through the admin query in the same shape they went in", async () => {
    await updateSettings(session, {
      serviceAreas: [{ en: "Doha", ar: "الدوحة" }],
    });

    const settings = await getAdminSettings(session);
    expect(settings.serviceAreas).toEqual([{ en: "Doha", ar: "الدوحة" }]);
  });

  it("record the change in the settings audit trail", async () => {
    // Pricing and areas both decide what a customer is shown, so "who changed
    // this?" has to stay answerable through the new column type too.
    await updateSettings(session, {
      serviceAreas: [{ en: "Al Khor", ar: "الخور" }],
    });

    const [row] = await testSql<{ changed_keys: string[] }[]>`
      SELECT changed_keys FROM settings_audit
       ORDER BY created_at DESC LIMIT 1
    `;
    expect(row.changed_keys).toContain("service_areas");
  });
});

describe("the single full-day price", () => {
  it("is written with setup and delivery at zero", async () => {
    // What the settings screen now sends. The columns survive for the sake of
    // bookings taken under the old split; the day rate carries the whole price.
    await updateSettings(session, {
      priceRental: 545000,
      priceSetup: 0,
      priceDelivery: 0,
    });

    const settings = await getAdminSettings(session);
    expect(settings.priceRental).toBe(545000);
    expect(settings.priceSetup).toBe(0);
    expect(settings.priceDelivery).toBe(0);
  });

  it("still satisfies the booking CHECK that total equals the parts", async () => {
    // price_total = rental + setup + delivery is enforced on every booking row.
    // With the other two at zero the day rate IS the total, which is the whole
    // point — but it has to actually hold, or no booking can be written.
    const [row] = await testSql<{ ok: boolean }[]>`
      SELECT (price_rental + price_setup + price_delivery = price_rental) AS ok
        FROM settings WHERE id = 1
    `;
    expect(row.ok).toBe(true);
  });
});

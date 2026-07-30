import { describe, it, expect } from "vitest";
import {
  areaLabel,
  serviceAreaSchema,
  toServiceAreas,
} from "@/lib/booking/serviceArea";

/**
 * Service areas became bilingual in migration 0012. Two properties matter and
 * neither is obvious from the type: the ENGLISH name is canonical, and the
 * pre-0012 shape must still render rather than crash a cached page.
 */

describe("the label a customer reads", () => {
  const area = { en: "Al Wakrah", ar: "الوكرة" };

  it("follows the reader's language", () => {
    expect(areaLabel(area, "ar")).toBe("الوكرة");
    expect(areaLabel(area, "en")).toBe("Al Wakrah");
  });

  it("falls back to English when the Arabic name is missing", () => {
    // A half-finished list must still produce a tappable chip; a blank one is
    // a control nobody can identify or press with confidence.
    expect(areaLabel({ en: "Lusail", ar: "" }, "ar")).toBe("Lusail");
    expect(areaLabel({ en: "Lusail", ar: "   " }, "ar")).toBe("Lusail");
  });
});

describe("reading what the API sends", () => {
  it("accepts the bilingual shape", () => {
    expect(toServiceAreas([{ en: "Doha", ar: "الدوحة" }])).toEqual([
      { en: "Doha", ar: "الدوحة" },
    ]);
  });

  it("still understands the plain strings stored before 0012", () => {
    // An edge-cached /api/settings response, or a database that has not been
    // migrated yet. The booking form must show chips, not a blank step.
    expect(toServiceAreas(["Doha", "Lusail"])).toEqual([
      { en: "Doha", ar: "Doha" },
      { en: "Lusail", ar: "Lusail" },
    ]);
  });

  it("drops entries it cannot use instead of throwing", () => {
    expect(
      toServiceAreas([{ ar: "الدوحة" }, "", null, 7, { en: "Doha", ar: "" }]),
    ).toEqual([{ en: "Doha", ar: "" }]);
    expect(toServiceAreas(undefined)).toEqual([]);
    expect(toServiceAreas({ en: "not-an-array" })).toEqual([]);
  });
});

describe("what the admin endpoint will accept", () => {
  it("requires an English name", () => {
    // It is the value written to bookings.area, so a row without one would
    // produce a chip that stores nothing.
    expect(serviceAreaSchema.safeParse({ en: "", ar: "الدوحة" }).success).toBe(
      false,
    );
  });

  it("allows a blank Arabic name", () => {
    expect(serviceAreaSchema.safeParse({ en: "Doha", ar: "" }).success).toBe(
      true,
    );
  });

  it("trims, so a stray space cannot create a near-duplicate area", () => {
    const parsed = serviceAreaSchema.parse({ en: "  Doha ", ar: " الدوحة " });
    expect(parsed).toEqual({ en: "Doha", ar: "الدوحة" });
  });
});

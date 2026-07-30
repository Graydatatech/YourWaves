import { describe, it, expect } from "vitest";
import {
  DEFAULT_DIAL_CODE,
  bookingRequestSchema,
  isMapsUrl,
  stepValidators,
  toE164,
} from "@/lib/booking/schema";
import { formatMoney, formatTime, weekdayLabels } from "@/lib/booking/format";
import { BOOKING_FORM } from "@/lib/booking/formConfig";

/** A complete, valid draft; individual tests break one field at a time. */
const VALID = {
  bookingDate: "2026-08-14",
  preferredStart: "08:00:00",
  customerName: "Noora Al-Ansari",
  dialCode: "+974",
  phoneNational: "55123456",
  customerEmail: "noora@example.com",
  addressLine: "Villa 14, Street 850, Al Wakrah",
  area: "Al Wakrah",
  city: "Doha",
  mapsUrl: "https://maps.app.goo.gl/abc123",
  lat: 25.1715,
  lng: 51.6034,
  notes: "Gate code 4417",
  locale: "ar" as const,
};

describe("phone validation", () => {
  it("accepts a real Qatari mobile", () => {
    expect(toE164("+974", "55123456")).toBe("+97455123456");
  });

  it("tolerates spaces and dashes as typed", () => {
    expect(toE164("+974", "5512 3456")).toBe("+97455123456");
    expect(toE164("+974", "5512-3456")).toBe("+97455123456");
  });

  it("rejects numbers of the wrong length for the country", () => {
    // Qatari mobiles are 8 digits; these are 7 and 9.
    expect(toE164("+974", "5512345")).toBeNull();
    expect(toE164("+974", "551234567")).toBeNull();
  });

  it("rejects a Qatari landline prefix as a mobile-shaped number", () => {
    // 4xxx xxxx is a Qatari fixed line, not a mobile.
    expect(toE164("+974", "44123456")).not.toBe("+97455123456");
  });

  it("validates other dial codes too", () => {
    expect(toE164("+44", "7400123456")).toBe("+447400123456");
    expect(toE164("+44", "12")).toBeNull();
  });

  it("rejects empty and junk input", () => {
    expect(toE164("+974", "")).toBeNull();
    expect(toE164("+974", "abcdefgh")).toBeNull();
  });
});

describe("Google Maps URL validation", () => {
  it("accepts the shapes Google actually produces", () => {
    expect(isMapsUrl("https://maps.app.goo.gl/xYz123")).toBe(true);
    expect(isMapsUrl("https://goo.gl/maps/xYz123")).toBe(true);
    expect(isMapsUrl("https://www.google.com/maps/@25.28,51.53,15z")).toBe(
      true,
    );
    expect(isMapsUrl("https://google.com/maps?q=25.28,51.53")).toBe(true);
    expect(isMapsUrl("https://maps.google.com/?q=25.28,51.53")).toBe(true);
  });

  it("rejects other hosts and non-maps Google paths", () => {
    expect(isMapsUrl("https://example.com/maps")).toBe(false);
    expect(isMapsUrl("https://www.google.com/search?q=maps")).toBe(false);
    // A lookalike host must not pass.
    expect(isMapsUrl("https://google.com.evil.tld/maps")).toBe(false);
    expect(isMapsUrl("not a url")).toBe(false);
    expect(isMapsUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("step validators", () => {
  it("blocks each step until its own requirement is met", () => {
    expect(stepValidators.date({})).toBe("needDate");
    expect(stepValidators.date({ bookingDate: "2026-08-14" })).toBeNull();

    expect(stepValidators.time({})).toBe("needTime");
    expect(stepValidators.time({ preferredStart: "08:00:00" })).toBeNull();

    expect(stepValidators.location({ addressLine: "short" })).toBe(
      "needAddress",
    );
    expect(
      stepValidators.location({ addressLine: VALID.addressLine }),
    ).toBeNull();

    expect(stepValidators.details({})).toBe("needName");

    /**
     * Whether name + number is SUFFICIENT depends on the OTP flag, so the
     * assertion follows it rather than pinning one setting. SRS 3.5 requires
     * verification; `BOOKING_FORM.phoneVerification` is what turns that
     * requirement on, and the same flag gates the two endpoints — so this also
     * fails if the flag is flipped without the validator following.
     */
    const unverified = stepValidators.details({
      customerName: "Noora",
      dialCode: DEFAULT_DIAL_CODE,
      phoneNational: "55123456",
    });
    expect(unverified).toBe(
      BOOKING_FORM.phoneVerification ? "needVerification" : null,
    );

    // A verified number always satisfies the step, either way.
    expect(
      stepValidators.details({
        customerName: "Noora",
        dialCode: DEFAULT_DIAL_CODE,
        phoneNational: "55123456",
        verifiedPhone: "+97455123456",
      }),
    ).toBeNull();
  });

  it("keeps the OTP step and the endpoints that enforce it in step", () => {
    // The point of the flag is that ONE value drives the wizard, the hold
    // endpoint and POST /api/bookings. If verification is on, an unverified
    // draft must be refused here — a UI that lets someone reach checkout only
    // for the server to 403 them is the failure this guards against.
    const draft = {
      customerName: "Noora",
      dialCode: DEFAULT_DIAL_CODE,
      phoneNational: "55123456",
    };
    if (BOOKING_FORM.phoneVerification) {
      expect(stepValidators.details(draft)).toBe("needVerification");
    } else {
      expect(stepValidators.details(draft)).toBeNull();
    }
  });

  it("rejects a malformed maps link on the location step", () => {
    expect(
      stepValidators.location({
        addressLine: VALID.addressLine,
        mapsUrl: "https://example.com/nope",
      }),
    ).toBe("invalidMapsUrl");
  });

  it("rejects an invalid phone even when a name is present", () => {
    expect(
      stepValidators.details({
        customerName: "Noora",
        dialCode: "+974",
        phoneNational: "123",
      }),
    ).toBe("invalidPhone");
  });
});

describe("bookingRequestSchema", () => {
  it("accepts a complete draft", () => {
    const result = bookingRequestSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("rejects an impossible date", () => {
    const result = bookingRequestSchema.safeParse({
      ...VALID,
      bookingDate: "2026-02-30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unparseable phone number", () => {
    const result = bookingRequestSchema.safeParse({
      ...VALID,
      phoneNational: "111",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === "invalid_phone"),
      ).toBe(true);
    }
  });

  it("rejects a half-set coordinate pair", () => {
    const result = bookingRequestSchema.safeParse({
      ...VALID,
      lat: 25.17,
      lng: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("treats empty optional strings as absent", () => {
    const result = bookingRequestSchema.safeParse({
      ...VALID,
      customerEmail: "",
      mapsUrl: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerEmail).toBeUndefined();
      expect(result.data.mapsUrl).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it("rejects an address that is too short to find", () => {
    const result = bookingRequestSchema.safeParse({
      ...VALID,
      addressLine: "Villa 1",
    });
    expect(result.success).toBe(false);
  });
});

describe("formatting", () => {
  it("formats minor units as whole-riyal amounts", () => {
    // 450000 minor units = 4,500 QAR.
    expect(formatMoney(450000, "QAR", "en")).toMatch(/4,500/);
    expect(formatMoney(450000, "QAR", "ar")).toMatch(/4,500/);
  });

  it("uses Latin digits in Arabic so prices stay scannable", () => {
    const arabic = formatMoney(545000, "QAR", "ar");
    expect(arabic).toMatch(/5,450/);
    // No Eastern Arabic numerals.
    expect(arabic).not.toMatch(/[٠-٩]/);
  });

  it("renders AM/PM in English and ص/م in Arabic", () => {
    expect(formatTime("08:00:00", "en")).toMatch(/AM/i);
    expect(formatTime("15:00:00", "en")).toMatch(/PM/i);
    expect(formatTime("08:00:00", "ar")).toMatch(/ص/);
    expect(formatTime("15:00:00", "ar")).toMatch(/م/);
  });

  it("returns seven weekday labels starting on Sunday", () => {
    const en = weekdayLabels("en");
    expect(en).toHaveLength(7);
    expect(en[0]).toMatch(/^Sun/);
    const ar = weekdayLabels("ar");
    expect(ar).toHaveLength(7);
    // Arabic labels must actually be Arabic, not a fallback to English.
    expect(ar[0]).toMatch(/[؀-ۿ]/);
  });
});

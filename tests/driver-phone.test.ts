import { describe, expect, it } from "vitest";
import { normaliseDriverPhone } from "@/lib/admin/driverPhone";

/**
 * A driver is identified by their number, so what the settings form accepts has
 * to survive the ways an admin will actually type one: bare local digits from
 * the fixed +974 prefix, or a full international number pasted out of WhatsApp.
 *
 * Getting this wrong is not a validation nicety — the number is where the job
 * sheet, the arrival time and the maps link are sent.
 */
describe("driver phone normalisation", () => {
  it("accepts bare local digits, which is what the form produces", () => {
    expect(normaliseDriverPhone("55010001")).toBe("+97455010001");
  });

  it("accepts a pasted international number without doubling the country code", () => {
    // The bug this guards: "+974..." naively prefixed again becomes
    // "+974974..." — a plausible-looking string that reaches nobody.
    expect(normaliseDriverPhone("+97455010001")).toBe("+97455010001");
    expect(normaliseDriverPhone("+974 5501 0001")).toBe("+97455010001");
    expect(normaliseDriverPhone("974 55010001")).toBe("+97455010001");
  });

  it("tolerates the separators people paste", () => {
    expect(normaliseDriverPhone("5501-0001")).toBe("+97455010001");
    expect(normaliseDriverPhone(" 5501 0001 ")).toBe("+97455010001");
  });

  it("rejects anything that could not be dialled", () => {
    // libphonenumber, not a regex: "looks like a phone number" and "is a
    // reachable Qatari mobile" are different questions.
    for (const input of [
      "",
      "   ",
      "123",
      "00000000",
      "notaphone",
      "+974123",
    ]) {
      expect(normaliseDriverPhone(input), input).toBeNull();
    }
  });

  it("keeps a valid non-Qatari number rather than mangling it", () => {
    // A crew member on a Gulf SIM still has to receive the job sheet.
    expect(normaliseDriverPhone("+971501234567")).toBe("+971501234567");
    expect(normaliseDriverPhone("+966501234567")).toBe("+966501234567");
  });

  it("rejects a number that is well-formed but not allocatable", () => {
    // +44 7700 900xxx is Ofcom's reserved drama range — the number you see in
    // films. It parses cleanly and reaches nobody, which is exactly why
    // validation is libphonenumber's job rather than a length check.
    expect(normaliseDriverPhone("+447700900123")).toBeNull();
  });
});

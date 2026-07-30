import { describe, expect, it } from "vitest";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/notifications/types";
import { TEMPLATES } from "@/lib/notifications/templates";
import { renderEmail, renderWhatsApp } from "@/lib/notifications/render";
import {
  arrivalClockTime,
  buildMapsLink,
} from "@/lib/notifications/templates/context";
import { samplePayloadFor } from "@/lib/notifications/samples";
import WHATSAPP_PARAMS from "@/lib/notifications/templates/whatsapp-params.json";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

/**
 * Template rendering.
 *
 * No database: these are pure functions of a payload. What they guard is the
 * class of fault that is invisible until a customer opens the mail — a key that
 * renders as its own name, an Arabic email that is actually English, a
 * parameter count Meta will reject.
 */

const LOCALES = ["ar", "en"] as const;

/**
 * Intl.NumberFormat separates the currency code from the amount with a
 * NON-BREAKING space (U+00A0), not a plain one. Comparing against a typed
 * space silently fails on every money assertion.
 */
function plainSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ");
}

/** next-intl emits the raw key when a message is missing. */
function looksLikeRawKey(text: string): string[] {
  return [
    ...text.matchAll(
      /\b(?:common|price|prep|bookingConfirmed|adminBookingConfirmed|driverAssignment|status|adminRefundRequired|adminNotificationFailed)\.[a-zA-Z_.]+/g,
    ),
  ].map((match) => match[0]);
}

describe("every template renders in both locales", () => {
  for (const key of TEMPLATE_KEYS) {
    for (const locale of LOCALES) {
      it(`${key} / ${locale}`, async () => {
        const payload = samplePayloadFor(key);
        const definition = TEMPLATES[key];

        const message = await renderEmail(key, locale, payload);

        if (!definition.email) {
          // A deliberate no-op, not a missing template.
          expect(message).toBeNull();
          return;
        }

        expect(message).not.toBeNull();
        expect(message!.subject.length).toBeGreaterThan(5);
        expect(message!.html).toContain("<html");
        expect(message!.text.length).toBeGreaterThan(40);

        // The failure mode from phase 3: a missing namespace renders every
        // string as its own key, and the email still "works".
        expect(looksLikeRawKey(message!.subject)).toEqual([]);
        expect(looksLikeRawKey(message!.text)).toEqual([]);
      });
    }
  }
});

describe("direction and language", () => {
  it("marks Arabic mail rtl and English mail ltr", async () => {
    const arabic = await renderEmail(
      "booking_confirmed",
      "ar",
      samplePayloadFor("booking_confirmed"),
    );
    const english = await renderEmail(
      "booking_confirmed",
      "en",
      samplePayloadFor("booking_confirmed"),
    );

    expect(arabic!.html).toContain('dir="rtl"');
    expect(arabic!.html).toContain('lang="ar"');
    expect(english!.html).toContain('dir="ltr"');
    expect(english!.html).toContain('lang="en"');
  });

  it("renders Arabic copy, not English copy in an rtl wrapper", async () => {
    const message = await renderEmail(
      "booking_confirmed",
      "ar",
      samplePayloadFor("booking_confirmed"),
    );

    // The heading from messages/ar.json, not its English counterpart.
    expect(message!.text).toContain(ar.notifications.bookingConfirmed.heading);
    expect(message!.text).not.toContain(
      en.notifications.bookingConfirmed.heading,
    );
    // Arabic script is actually present.
    expect(message!.text).toMatch(/[؀-ۿ]/);
  });

  it("aligns tables to the start edge of the reading direction", async () => {
    const arabic = await renderEmail(
      "booking_confirmed",
      "ar",
      samplePayloadFor("booking_confirmed"),
    );
    const english = await renderEmail(
      "booking_confirmed",
      "en",
      samplePayloadFor("booking_confirmed"),
    );

    expect(arabic!.html).toContain('align="right"');
    expect(english!.html).toContain('align="left"');
  });

  it("isolates the reference so bidi cannot reorder it", async () => {
    const message = await renderEmail(
      "booking_confirmed",
      "ar",
      samplePayloadFor("booking_confirmed"),
    );
    // The same protection <Bidi> gives the site: an LTR run inside RTL copy.
    expect(message!.html).toMatch(/dir="ltr"[^>]*>\s*YW-2026-0148/);
  });
});

describe("email client compatibility", () => {
  it("uses no layout technique Outlook's Word engine cannot render", async () => {
    for (const key of TEMPLATE_KEYS) {
      if (!TEMPLATES[key].email) continue;
      const message = await renderEmail(key, "en", samplePayloadFor(key));
      const html = message!.html;

      expect(html, `${key}: flexbox`).not.toMatch(/display:\s*flex/i);
      expect(html, `${key}: grid`).not.toMatch(/display:\s*grid/i);
      expect(html, `${key}: css variable`).not.toMatch(/var\(--/);
      // A <style> block is stripped in several Gmail contexts, so every rule
      // must be inline.
      expect(html, `${key}: style block`).not.toMatch(/<style[\s>]/i);
      expect(html, `${key}: external stylesheet`).not.toMatch(
        /<link[^>]+stylesheet/i,
      );
    }
  });

  it("gives the gradient header a solid background Outlook can use", async () => {
    const message = await renderEmail(
      "booking_confirmed",
      "en",
      samplePayloadFor("booking_confirmed"),
    );
    // Both on the same element: Word ignores the image and keeps the solid.
    expect(message!.html).toMatch(
      /background-color:#22c3d4;background-image:linear-gradient/,
    );
  });

  it("keeps the layout inside 600px", async () => {
    const message = await renderEmail(
      "booking_confirmed",
      "en",
      samplePayloadFor("booking_confirmed"),
    );
    expect(message!.html).toContain("max-width:600px");
  });

  it("embeds no remote images", async () => {
    // Gmail and Outlook block them by default, so a logo <img> is a broken
    // icon on first open. The mark is type, not an image.
    for (const key of TEMPLATE_KEYS) {
      if (!TEMPLATES[key].email) continue;
      const message = await renderEmail(key, "en", samplePayloadFor(key));
      expect(message!.html, key).not.toMatch(/<img[^>]+src="https?:/i);
    }
  });
});

describe("the four SRS triggers carry their required content", () => {
  it("3.4.1 order received: invoice breakdown and preparation notes", async () => {
    const payload = samplePayloadFor("booking_confirmed");
    const message = await renderEmail("booking_confirmed", "en", payload);
    const text = plainSpaces(message!.text);

    expect(message!.subject).toContain("YW-2026-0148");
    for (const fragment of [
      "YW-2026-0148",
      "August 14, 2026",
      "10:00 AM",
      "Villa 12",
    ]) {
      expect(text, fragment).toContain(fragment);
    }
    // Every price line, then the total.
    expect(text).toContain("QAR 4,500");
    expect(text).toContain("QAR 600");
    expect(text).toContain("QAR 350");
    expect(text).toContain("QAR 5,450");
    // Home preparation notes.
    expect(text).toContain(en.notifications.prep.space);
    expect(text).toContain(en.notifications.prep.water);
  });

  it("3.4.2 new booking alert: customer contact, maps link and an assign CTA", async () => {
    const message = await renderEmail(
      "admin_booking_confirmed",
      "en",
      samplePayloadFor("admin_booking_confirmed"),
    );

    expect(message!.text).toContain("+97455123456");
    expect(message!.text).toContain("Noora Al-Ansari");
    expect(message!.html).toContain("google.com/maps");
    expect(message!.html).toContain("/admin/bookings/YW-2026-0148");
    expect(message!.text).toContain(en.notifications.adminBookingConfirmed.cta);
    // The customer's note must reach whoever schedules the crew.
    expect(message!.text).toContain("side gate");
  });

  it("3.4.3 driver assignment: phone, address, maps link and arrival time", async () => {
    const message = await renderEmail(
      "driver_assignment",
      "en",
      samplePayloadFor("driver_assignment"),
    );

    expect(message!.text).toContain("+97455123456");
    expect(message!.text).toContain("Villa 12, Street 850");
    expect(message!.html).toContain("google.com/maps");
    // 90 minutes before the 10:00 start.
    expect(message!.text).toContain("8:30 AM");
    expect(message!.html).toContain("tel:+97455123456");
  });

  it("3.4.4 status updates: one template per transition, both languages", async () => {
    const keys: TemplateKey[] = [
      "booking_assigned",
      "booking_en_route",
      "booking_setup_complete",
      "booking_completed",
      "booking_cancelled",
    ];

    for (const key of keys) {
      for (const locale of LOCALES) {
        const message = await renderEmail(key, locale, samplePayloadFor(key));
        expect(message, `${key}/${locale}`).not.toBeNull();
        expect(message!.text).toContain("YW-2026-0148");

        const whatsapp = renderWhatsApp(key, locale, samplePayloadFor(key));
        expect(whatsapp, `${key}/${locale} whatsapp`).not.toBeNull();
      }
    }
  });
});

describe("the maps link opens the native app", () => {
  it("prefers coordinates, which are what a driver actually navigates to", () => {
    const link = buildMapsLink({ lat: 25.2599, lng: 51.4499 });
    // The ?api=1 search URL is claimed by the Google Maps app's universal-link
    // filters on both iOS and Android, and falls back to the web map.
    expect(link).toBe(
      "https://www.google.com/maps/search/?api=1&query=25.2599,51.4499",
    );
  });

  it("falls back to the customer's own link, then to the address", () => {
    expect(buildMapsLink({ maps_url: "https://maps.app.goo.gl/abc" })).toBe(
      "https://maps.app.goo.gl/abc",
    );

    const fromAddress = buildMapsLink({
      address_line: "Villa 12",
      area: "Al Waab",
    });
    expect(fromAddress).toContain("https://www.google.com/maps/search/?api=1");
    expect(fromAddress).toContain("Villa%2012");
    expect(fromAddress).toContain("Qatar");
  });
});

describe("crew arrival time", () => {
  it("is ninety minutes before the customer's slot", () => {
    expect(arrivalClockTime("10:00:00")).toBe("08:30:00");
    expect(arrivalClockTime("08:00:00")).toBe("06:30:00");
    expect(arrivalClockTime("15:00:00")).toBe("13:30:00");
  });

  it("clamps rather than producing a negative time", () => {
    // Cannot happen with real settings (the day starts at 08:00), but a
    // negative clock time would be worse than a clamped one.
    expect(arrivalClockTime("01:00:00")).toBe("00:00:00");
  });
});

describe("the WhatsApp parameter contract", () => {
  const contract = WHATSAPP_PARAMS.templates as Record<
    string,
    { messageKey: string; params: string[] }
  >;

  it("sends exactly the parameters the approved template will have", () => {
    for (const key of TEMPLATE_KEYS) {
      const definition = TEMPLATES[key].whatsapp;
      if (!definition) continue;

      const entry = contract[definition.templateName];
      expect(entry, definition.templateName).toBeDefined();

      const rendered = renderWhatsApp(key, "en", samplePayloadFor(key));
      // A count mismatch is Meta error (#132000) at send time.
      expect(rendered!.bodyParams, definition.templateName).toHaveLength(
        entry.params.length,
      );
      expect(
        rendered!.bodyParams.every((value) => typeof value === "string"),
      ).toBe(true);
    }
  });

  it("leaves no placeholder unfilled, in either language", () => {
    for (const key of TEMPLATE_KEYS) {
      if (!TEMPLATES[key].whatsapp) continue;
      for (const locale of LOCALES) {
        const rendered = renderWhatsApp(key, locale, samplePayloadFor(key));
        expect(rendered!.preview, `${key}/${locale}`).not.toMatch(
          /\{[a-zA-Z_]+\}/,
        );
        expect(rendered!.preview).not.toContain("undefined");
      }
    }
  });

  it("asks Meta for the language matching the booking", () => {
    expect(
      renderWhatsApp(
        "booking_confirmed",
        "ar",
        samplePayloadFor("booking_confirmed"),
      )!.language,
    ).toBe("ar");
    expect(
      renderWhatsApp(
        "booking_confirmed",
        "en",
        samplePayloadFor("booking_confirmed"),
      )!.language,
    ).toBe("en");
  });
});

describe("unknown and no-op templates", () => {
  it("throws on a template key that does not exist", async () => {
    await expect(renderEmail("not_a_real_template", "en", {})).rejects.toThrow(
      /unknown_template/,
    );
    expect(() => renderWhatsApp("not_a_real_template", "en", {})).toThrow(
      /unknown_template/,
    );
  });

  it("returns null for a key that deliberately sends nothing", async () => {
    // The customer is not told "we owe you a refund" by a robot.
    expect(
      await renderEmail(
        "payment_refund_required",
        "en",
        samplePayloadFor("payment_refund_required"),
      ),
    ).toBeNull();
  });

  it("renders an empty payload rather than throwing", async () => {
    // A payload written months ago, across a schema change. A template that
    // throws has already consumed an attempt and tells the customer nothing.
    const message = await renderEmail("booking_confirmed", "en", {});
    expect(message).not.toBeNull();
    expect(message!.html).toContain("<html");
    expect(message!.text).not.toContain("undefined");
  });
});

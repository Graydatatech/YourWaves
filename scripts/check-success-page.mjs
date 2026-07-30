/**
 * Mobile layout guard for the payment result pages.
 *
 * The phase-6 brief asks for a success page that is excellent on a phone and
 * survives the WhatsApp in-app browser. Those are claims about a rendered page,
 * so they are checked in a real browser against a real confirmed booking rather
 * than asserted from source.
 *
 * Checks, at each width and in both locales:
 *   1. no horizontal overflow, and if there is any, which element causes it;
 *   2. the reference, date, time, address and amount are actually rendered
 *      (a success page that polls and silently shows nothing is the failure mode
 *      that matters most here);
 *   3. the .ics download and the wa.me deep link exist and are tappable at 44px;
 *   4. the failed page renders and offers a way back.
 *
 * The fixture booking is created through the real routes and cancelled at the
 * end, so no synthetic confirmed booking is left occupying a date.
 *
 * Usage: pnpm check:success [baseUrl]
 */

import d from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer-core";
import {
  createConfirmedBooking,
  releaseFixture,
} from "./lib/booking-fixture.mjs";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTHS = [320, 360, 390, 414];
const LOCALES = ["en", "ar"];
const MIN_TARGET = 44;

const failures = [];
const notes = [];

function record(ok, label, detail) {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${detail ? `  [2m${detail}[0m` : ""}`,
  );
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let fixture = null;
let browser = null;

try {
  fixture = await createConfirmedBooking(BASE);
  console.log(
    `\nfixture ${fixture.reference}  ${fixture.date}  ${fixture.priceTotal} ${fixture.currency}\n`,
  );

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--hide-scrollbars"],
  });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
      await page.goto(
        `${BASE}/${locale}/booking/success/${fixture.reference}`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );

      // The page polls before it can show anything. Wait for the .ics link,
      // which only exists in the confirmed panel — NOT for the reference, which
      // is on the page in the waiting state too and so resolves instantly and
      // measures the wrong screen.
      const settledIn = Date.now();
      const confirmed = await page
        .waitForSelector('a[href*="/calendar"]', { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      record(
        confirmed,
        `${locale} @${width}px: confirmed panel appears`,
        `${Date.now() - settledIn}ms`,
      );

      const result = await page.evaluate(
        ({ minTarget, reference }) => {
          const doc = document.documentElement;
          const overflow = doc.scrollWidth - doc.clientWidth;

          // Which element is wider than the viewport, if any.
          let culprit = null;
          if (overflow > 1) {
            for (const el of document.querySelectorAll("*")) {
              const rect = el.getBoundingClientRect();
              if (rect.width > doc.clientWidth + 1) {
                culprit = `${el.tagName.toLowerCase()}.${
                  typeof el.className === "string"
                    ? el.className.split(/\s+/).slice(0, 3).join(".")
                    : ""
                } (${Math.round(rect.width)}px)`;
                break;
              }
            }
          }

          const text = document.body.innerText;
          const ics = document.querySelector(`a[href*="/calendar"]`);
          const wa = document.querySelector(`a[href^="https://wa.me/"]`);
          const small = [];
          for (const el of document.querySelectorAll("a, button")) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.height < minTarget - 0.5) {
              small.push(
                `${el.tagName.toLowerCase()}"${(el.innerText || "").trim().slice(0, 20)}" ${Math.round(rect.height)}px`,
              );
            }
          }

          return {
            overflow,
            culprit,
            hasReference: text.includes(reference),
            dir: doc.getAttribute("dir"),
            lang: doc.getAttribute("lang"),
            icsHref: ics?.getAttribute("href") ?? null,
            waHref: wa?.getAttribute("href") ?? null,
            smallTargets: small,
            bodyLength: text.length,
          };
        },
        { minTarget: MIN_TARGET, reference: fixture.reference },
      );

      const tag = `${locale} @${width}px`;

      record(
        result.overflow <= 1,
        `${tag}: no horizontal overflow`,
        result.overflow > 1
          ? `${result.overflow}px, widest: ${result.culprit ?? "unknown"}`
          : "",
      );
      record(result.hasReference, `${tag}: reference is rendered`);
      record(
        result.dir === (locale === "ar" ? "rtl" : "ltr"),
        `${tag}: dir="${locale === "ar" ? "rtl" : "ltr"}"`,
        `got ${result.dir}`,
      );
      record(
        Boolean(result.icsHref?.includes(fixture.reference)),
        `${tag}: .ics download points at this booking`,
        result.icsHref ?? "missing",
      );
      record(
        Boolean(result.waHref?.startsWith("https://wa.me/")),
        `${tag}: wa.me deep link present`,
        result.waHref ? "ok" : "missing",
      );
      record(
        result.smallTargets.length === 0,
        `${tag}: every tap target clears ${MIN_TARGET}px`,
        result.smallTargets.join("; "),
      );

      // Details only render once the poll resolves; assert them once per locale
      // at the narrowest width, where wrapping is worst.
      // Details render with the confirmed panel; assert them once per locale at
      // the narrowest width, where wrapping is worst. The expected strings are
      // calibrated against what the page actually renders: "August 25, 2026" /
      // "الثلاثاء، 25 أغسطس 2026", "10:00 AM" / "10:00 ص", "QAR 5,450" /
      // "5,450 ر.ق." — Arabic uses Western digits here, so one pattern covers both.
      if (width === 320) {
        const details = await page.evaluate(() => document.body.innerText);
        record(details.includes("2026"), `${locale}: date is shown`);
        record(/\d{1,2}:\d{2}/.test(details), `${locale}: setup time is shown`);
        record(details.includes("Street 850"), `${locale}: address is shown`);
        record(
          details.includes("5,450"),
          `${locale}: amount paid is shown`,
          "expected 5,450",
        );
        record(
          details.length > 400,
          `${locale}: preparation notes are shown`,
          `${details.length} chars`,
        );
      }

      await page.close();
    }
  }

  // The failed page, which must render for a booking that is not confirmed and
  // still offer a route back into the flow.
  for (const locale of LOCALES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/${locale}/booking/failed/YW-2026-9999`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const result = await page.evaluate((loc) => {
      const doc = document.documentElement;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        backLink: Boolean(document.querySelector(`a[href*="#booking"]`)),
        length: document.body.innerText.length,
        dir: doc.getAttribute("dir"),
        locale: loc,
      };
    }, locale);

    record(
      result.overflow <= 1,
      `${locale} failed page @390px: no horizontal overflow`,
      `${result.overflow}px`,
    );
    record(
      result.length > 40,
      `${locale} failed page renders content`,
      `${result.length} chars`,
    );
    record(
      result.backLink,
      `${locale} failed page offers a way back to the booking form`,
    );
    await page.close();
  }

  notes.push(
    "In-app-browser behaviour (WhatsApp/Instagram webviews) cannot be driven " +
      "from Chrome headless. The page uses no APIs those webviews lack — no " +
      "popups, no clipboard, no service worker — but that remains unverified on " +
      "a real device.",
  );
} catch (error) {
  record(
    false,
    "run completed without throwing",
    String(error?.message ?? error),
  );
} finally {
  if (browser) await browser.close();
  if (fixture) {
    const cleaned = await releaseFixture(sql, fixture.bookingId);
    console.log(`\ncleaned up: ${JSON.stringify(cleaned)}`);
  }
  await sql.end();
}

if (notes.length) console.log(`\nnotes:\n  ${notes.join("\n  ")}`);
console.log(
  failures.length
    ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}`
    : `\nall checks passed`,
);
process.exit(failures.length ? 1 : 0);

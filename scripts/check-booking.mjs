/**
 * Browser verification of the phase-3 acceptance criteria.
 *
 * These are the claims that cannot be checked by reading source:
 *   1. calendar cells are >= 44x44 CSS px at 320/390/414
 *   2. no horizontal scroll while the wizard is on screen
 *   3. every form control is >= 16px so iOS does not zoom on focus
 *   4. booked dates carry aria-disabled and cannot be selected
 *   5. an EN<->AR switch mid-wizard preserves every entered value AND the step
 *   6. the calendar grid mirrors in RTL (Sunday at the inline-start edge)
 *
 * Usage: node scripts/check-booking.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const failures = [];
const notes = [];
const ok = (m) => notes.push(`  ✓ ${m}`);
const bad = (m) => {
  failures.push(m);
  notes.push(`  ✗ ${m}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

async function openBooking(page, locale, width) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
  // `domcontentloaded`, not `networkidle0`: the availability request goes to a
  // Supabase project in ap-northeast-1 and can take several seconds, so waiting
  // for total network quiescence is both slow and flaky. The selector wait below
  // is the real readiness signal.
  await page.goto(`${BASE}/${locale}#booking`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector('[role="grid"] [data-date]', { timeout: 60000 });
  // Cells exist before availability lands. Wait for the grid to report real
  // data, otherwise every day still reads as its "pending" placeholder.
  await page.waitForSelector('[role="grid"][data-availability="loaded"]', {
    timeout: 60000,
  });
}

/** Steps the calendar forward one month and waits for that month to load. */
async function nextMonth(page) {
  await page.evaluate(() => {
    document.querySelector('[data-month-nav="next"]')?.click();
  });
  await page.waitForSelector('[role="grid"][data-availability="loaded"]', {
    timeout: 60000,
  });
  await new Promise((r) => setTimeout(r, 200));
}

// --- 1/2/3/6: geometry and mirroring -------------------------------------
for (const locale of ["ar", "en"]) {
  for (const width of [320, 360, 390, 414, 768]) {
    const page = await browser.newPage();
    try {
      await openBooking(page, locale, width);

      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        const cells = [...document.querySelectorAll("[data-date]")];
        const sizes = cells.map((c) => c.getBoundingClientRect());
        const minW = Math.min(...sizes.map((r) => r.width));
        const minH = Math.min(...sizes.map((r) => r.height));

        // Font size of every real form control.
        const controls = [
          ...document.querySelectorAll(
            "#booking input, #booking select, #booking textarea",
          ),
        ];
        const minFont = controls.length
          ? Math.min(
              ...controls.map((c) => parseFloat(getComputedStyle(c).fontSize)),
            )
          : null;

        // Column header order → does the grid mirror?
        const headers = [
          ...document.querySelectorAll('[role="columnheader"]'),
        ].map((h) => ({
          label: h.getAttribute("aria-label"),
          x: h.getBoundingClientRect().left,
        }));

        return {
          docWidth: doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          cellCount: cells.length,
          minW: Math.round(minW * 10) / 10,
          minH: Math.round(minH * 10) / 10,
          minFont,
          controlCount: controls.length,
          firstHeader: headers[0]?.label,
          firstHeaderX: headers[0]?.x,
          lastHeaderX: headers[headers.length - 1]?.x,
          dir: doc.getAttribute("dir"),
        };
      });

      const id = `${locale} @ ${width}px`;

      if (result.minW < 43.5 || result.minH < 43.5) {
        bad(
          `${id}: calendar cell ${result.minW}x${result.minH} is below 44x44`,
        );
      } else {
        ok(
          `${id}: cells ${result.minW}x${result.minH} (${result.cellCount} days)`,
        );
      }

      if (result.scrollWidth > result.docWidth + 1) {
        bad(
          `${id}: horizontal scroll (${result.scrollWidth} > ${result.docWidth})`,
        );
      }

      if (result.minFont !== null && result.minFont < 16) {
        bad(
          `${id}: a form control renders at ${result.minFont}px (<16 → iOS zoom)`,
        );
      }

      // Sunday must sit at the inline-start edge: leftmost in LTR, rightmost in RTL.
      const mirrored = result.firstHeaderX > result.lastHeaderX;
      if (locale === "ar" && !mirrored) {
        bad(
          `${id}: RTL grid is not mirrored (first header is not at the right)`,
        );
      }
      if (locale === "en" && mirrored) {
        bad(`${id}: LTR grid appears mirrored`);
      }
    } catch (error) {
      bad(`${locale} @ ${width}px: ${error.message}`);
    } finally {
      await page.close();
    }
  }
}

// --- 4: booked dates are genuinely unselectable --------------------------
{
  const page = await browser.newPage();
  try {
    await openBooking(page, "en", 390);
    // The seeded bookings are next month; page forward until one is on screen.
    for (let i = 0; i < 3; i++) {
      const found = await page.$(
        '[data-state="booked"],[data-state="blackout"]',
      );
      if (found) break;
      await nextMonth(page);
    }
    const outcome = await page.evaluate(async () => {
      const blocked = [
        ...document.querySelectorAll(
          '[data-state="booked"],[data-state="blackout"]',
        ),
      ];
      if (blocked.length === 0) return { blocked: 0 };
      const cell = blocked[0];
      const date = cell.getAttribute("data-date");
      const ariaDisabled = cell.getAttribute("aria-disabled");
      cell.click();
      await new Promise((r) => setTimeout(r, 250));
      // If selection took, the cell would be marked selected.
      const gridcell = cell.closest('[role="gridcell"]');
      return {
        blocked: blocked.length,
        date,
        ariaDisabled,
        becameSelected: gridcell?.getAttribute("aria-selected") === "true",
      };
    });

    if (outcome.blocked === 0) {
      bad(
        "no booked/blackout day present in the current month — seed one so this " +
          "criterion is actually exercised",
      );
    } else if (outcome.ariaDisabled !== "true") {
      bad(`booked day ${outcome.date} is missing aria-disabled="true"`);
    } else if (outcome.becameSelected) {
      bad(`booked day ${outcome.date} became selected on click`);
    } else {
      ok(
        `booked/blackout days unselectable (${outcome.blocked} found, tested ${outcome.date})`,
      );
    }
  } catch (error) {
    bad(`booked-date check: ${error.message}`);
  } finally {
    await page.close();
  }
}

// --- 5: state survives a language switch mid-wizard ----------------------
{
  const page = await browser.newPage();
  try {
    await openBooking(page, "en", 390);

    // Step 1: choose the first available date.
    const chosenDate = await page.evaluate(async () => {
      const cell = document.querySelector('[data-state="available"]');
      if (!cell) return null;
      cell.click();
      await new Promise((r) => setTimeout(r, 200));
      return cell.getAttribute("data-date");
    });
    if (!chosenDate) throw new Error("no available date to select");

    // Advance to step 2 and pick a time.
    await page.evaluate(async () => {
      const next = [...document.querySelectorAll("#booking button")].find((b) =>
        /next/i.test(b.textContent ?? ""),
      );
      next?.click();
      await new Promise((r) => setTimeout(r, 300));
      const slot = document.querySelector('[role="radio"]');
      slot?.click();
      await new Promise((r) => setTimeout(r, 200));
    });

    // Advance to step 3 and type an address.
    // The address is three numbered fields now; this is what they compose to.
    const ADDRESS_PARTS = { building: "14", street: "850", zone: "55" };
    const ADDRESS = "Building 14, Street 850, Zone 55";
    await page.evaluate(async (parts) => {
      const next = [...document.querySelectorAll("#booking button")].find((b) =>
        /next/i.test(b.textContent ?? ""),
      );
      next?.click();
      await new Promise((r) => setTimeout(r, 300));
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      // Each part into its own box. React tracks the DOM value node, so the
      // native setter plus a bubbled `input` is what makes it see the change —
      // assigning .value directly is swallowed.
      for (const [part, value] of Object.entries(parts)) {
        const input = document.querySelector(
          `#booking input[data-address-part="${part}"]`,
        );
        if (input) {
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 60));
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }, ADDRESS_PARTS);

    const before = await page.evaluate(() => {
      const raw = sessionStorage.getItem("yourwaves.booking.draft.v1");
      return raw ? JSON.parse(raw) : null;
    });

    // Now switch language via the header pill — a real navigation.
    await page.evaluate(async () => {
      const link = document.querySelector('header a[hreflang="ar"]');
      link?.click();
    });
    await page.waitForFunction(
      () => document.documentElement.getAttribute("dir") === "rtl",
      { timeout: 60000 },
    );
    // The wizard restores the step the user was on — step 3 has no calendar,
    // so wait for the address field rather than the grid.
    await page.waitForSelector(
      '#booking input[data-address-part="building"]',
      { timeout: 60000 },
    );
    await new Promise((r) => setTimeout(r, 600));

    const after = await page.evaluate(() => {
      const raw = sessionStorage.getItem("yourwaves.booking.draft.v1");
      const parsed = raw ? JSON.parse(raw) : null;
      const read = (part) =>
        document.querySelector(`#booking input[data-address-part="${part}"]`)
          ?.value ?? null;
      return {
        stored: parsed,
        // Recomposed from what is actually painted in the three boxes, so this
        // proves the FIELDS rehydrated — not merely that sessionStorage still
        // holds the composed line.
        renderedAddress:
          read("building") && read("street") && read("zone")
            ? `Building ${read("building")}, Street ${read("street")}, Zone ${read("zone")}`
            : null,
        dir: document.documentElement.getAttribute("dir"),
      };
    });

    const b = before?.draft ?? {};
    const a = after.stored?.draft ?? {};

    if (after.dir !== "rtl") {
      bad("language switch did not reach the Arabic document");
    }
    if (a.bookingDate !== b.bookingDate || !a.bookingDate) {
      bad(
        `date lost across language switch (${b.bookingDate} → ${a.bookingDate})`,
      );
    }
    if (a.preferredStart !== b.preferredStart || !a.preferredStart) {
      bad(
        `time lost across language switch (${b.preferredStart} → ${a.preferredStart})`,
      );
    }
    if (a.addressLine !== ADDRESS) {
      bad(
        `address lost across language switch (got ${JSON.stringify(a.addressLine)})`,
      );
    }
    if (after.stored?.step !== before?.step) {
      bad(
        `step changed across language switch (${before?.step} → ${after.stored?.step})`,
      );
    }
    if (after.renderedAddress !== ADDRESS) {
      bad(
        `address not rehydrated into the field (got ${JSON.stringify(after.renderedAddress)})`,
      );
    }
    if (
      a.bookingDate === b.bookingDate &&
      a.preferredStart === b.preferredStart &&
      a.addressLine === ADDRESS &&
      after.stored?.step === before?.step &&
      after.renderedAddress === ADDRESS
    ) {
      ok(
        `EN→AR preserved date=${a.bookingDate} time=${a.preferredStart} ` +
          `address + step="${after.stored.step}"`,
      );
    }
    // The locale in the draft must follow the URL, since it drives notifications.
    if (a.locale !== "ar") {
      bad(`draft locale did not follow the switch (got ${a.locale})`);
    } else {
      ok("draft locale followed the switch → ar");
    }
  } catch (error) {
    bad(`language-switch check: ${error.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

console.log(notes.join("\n"));
if (failures.length) {
  console.error(
    `\n✗ ${failures.length} failure(s):\n - ${failures.join("\n - ")}`,
  );
  process.exit(1);
}
console.log("\n✓ All booking checks passed.");

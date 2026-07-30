/**
 * Layout guard for the marketing page.
 *
 * Verifies, in a real browser, the acceptance criteria that cannot be checked
 * by reading source:
 *   1. no horizontal scroll at any tested width;
 *   2. if there is overflow, WHICH element causes it (so the fix is targeted
 *      rather than an overflow-x:hidden band-aid);
 *   3. the header nav occupies exactly one row;
 *   4. interactive targets clear 44x44 CSS px;
 *   5. h1/h2/body font sizes are within the specified clamp ranges.
 *
 * Usage: node scripts/check-layout.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WIDTHS = [320, 360, 390, 414, 768, 1024, 1440, 1920];
const LOCALES = ["ar", "en"];

// Elements that are legitimately allowed to scroll on the inline axis.
const SCROLLERS = ".snap-row";

const failures = [];
const notes = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
    // Not networkidle0: the booking section fetches availability from a
    // Supabase project in ap-northeast-1, which can take several seconds, so
    // waiting for total network quiescence is slow and flaky. Wait for the
    // booking calendar to report real data instead — by then the page is fully
    // laid out, which is what this script measures.
    await page.goto(`${BASE}/${locale}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page
      .waitForSelector('[role="grid"][data-availability="loaded"]', {
        timeout: 60000,
      })
      .catch(() => {}); // Booking absent (e.g. future layout change) is not a layout failure.

    const result = await page.evaluate((scrollerSel) => {
      const docWidth = document.documentElement.clientWidth;

      // --- 1/2. horizontal overflow, and the culprit ---------------------
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(scrollerSel)) continue; // intentional scroller
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // 1px tolerance for sub-pixel rounding.
        if (r.right > docWidth + 1 || r.left < -1) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls:
              typeof el.className === "string" ? el.className.slice(0, 90) : "",
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
      }

      // --- 3. header nav on one row -------------------------------------
      // Children are vertically centred but have different heights, so their
      // `top` values legitimately differ. Wrapping is detected by comparing
      // vertical CENTRES: on one row every centre coincides.
      const headerRow = document.querySelector("header > div");
      let headerRows = 0;
      let headerHeight = 0;
      if (headerRow) {
        headerHeight = Math.round(headerRow.getBoundingClientRect().height);
        const centres = [];
        for (const child of headerRow.children) {
          const r = child.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          centres.push(r.top + r.height / 2);
        }
        // Cluster centres that are within 6px of each other.
        centres.sort((a, b) => a - b);
        headerRows = centres.length ? 1 : 0;
        for (let i = 1; i < centres.length; i++) {
          if (centres[i] - centres[i - 1] > 6) headerRows++;
        }
      }

      // --- 4. tap targets ------------------------------------------------
      const small = [];
      const interactive = document.querySelectorAll(
        "header a, header button, main a, main button, footer a, footer button",
      );
      for (const el of interactive) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // hidden
        if (r.height < 44 || r.width < 44) {
          small.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? "").trim().slice(0, 28),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }

      // --- 5. type scale --------------------------------------------------
      const px = (sel) => {
        const el = document.querySelector(sel);
        return el ? parseFloat(getComputedStyle(el).fontSize) : null;
      };

      // "Body copy" means running prose, not badges/kickers/eyebrows, which
      // are legitimately small. Prose carries .text-body or .text-base.
      const prose = document.querySelectorAll(
        "main .text-body, main p.text-base, main blockquote",
      );
      const smallProse = [];
      let minProse = Infinity;
      for (const el of prose) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        minProse = Math.min(minProse, size);
        if (size < 16) {
          smallProse.push({
            text: (el.textContent ?? "").trim().slice(0, 30),
            size,
          });
        }
      }

      return {
        docWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders: offenders.slice(0, 6),
        headerRows,
        headerHeight,
        small: small.slice(0, 6),
        h1: px("h1"),
        h2: px("h2"),
        proseCount: prose.length,
        minProse: minProse === Infinity ? null : minProse,
        smallProse: smallProse.slice(0, 4),
      };
    }, SCROLLERS);

    const id = `${locale} @ ${width}px`;

    if (result.scrollWidth > result.docWidth + 1) {
      failures.push(
        `${id}: horizontal scroll (scrollWidth ${result.scrollWidth} > ${result.docWidth})` +
          (result.offenders.length
            ? `\n     culprits: ${result.offenders
                .map(
                  (o) => `<${o.tag} class="${o.cls}"> [${o.left}..${o.right}]`,
                )
                .join("\n               ")}`
            : ""),
      );
    }

    if (result.headerRows > 1) {
      failures.push(`${id}: header wrapped onto ${result.headerRows} rows`);
    }

    if (result.small.length) {
      failures.push(
        `${id}: tap targets under 44px → ${result.small
          .map((s) => `<${s.tag}>"${s.text}" ${s.w}x${s.h}`)
          .join(", ")}`,
      );
    }

    // h1 clamp(34,7vw,84); h2 clamp(28,5vw,52); body >= 16
    if (result.h1 !== null && (result.h1 < 33.5 || result.h1 > 84.5)) {
      failures.push(`${id}: h1 ${result.h1}px outside clamp(34,7vw,84)`);
    }
    if (result.h2 !== null && (result.h2 < 27.5 || result.h2 > 52.5)) {
      failures.push(`${id}: h2 ${result.h2}px outside clamp(28,5vw,52)`);
    }
    if (result.smallProse.length) {
      failures.push(
        `${id}: body copy below the 16px floor → ${result.smallProse
          .map((p) => `"${p.text}" ${p.size}px`)
          .join(", ")}`,
      );
    }

    notes.push(
      `${id.padEnd(16)} header ${result.headerHeight}px/${result.headerRows} row  ` +
        `h1 ${result.h1?.toFixed(1)}  h2 ${result.h2?.toFixed(1)}  ` +
        `prose min ${result.minProse?.toFixed(1)} (${result.proseCount} nodes)`,
    );

    await page.close();
  }
}

await browser.close();

console.log("Measurements\n" + notes.join("\n"));

if (failures.length) {
  console.error(
    `\n✗ ${failures.length} failure(s):\n - ${failures.join("\n - ")}`,
  );
  process.exit(1);
}
console.log("\n✓ All layout checks passed.");

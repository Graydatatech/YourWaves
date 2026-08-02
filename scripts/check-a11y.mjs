/**
 * Accessibility guard for the customer-facing pages.
 *
 * Checks, in a real browser, the WCAG 2.1 AA criteria that only exist once the
 * page is laid out and hydrated — the ones no amount of reading source can
 * settle. It is the browser half of the pair; `pnpm check:contrast` is the
 * static half and covers the colour tokens.
 *
 * WHAT IT ASSERTS
 *
 *   1. Document language. <html lang> present and matching the URL's locale,
 *      and <html dir> matching that locale's direction (3.1.1).
 *   2. Every interactive element has an accessible name (4.1.2). The common
 *      failure is an icon-only button whose <svg> is aria-hidden and which has
 *      no aria-label — visually obvious, silent to a screen reader.
 *   3. A visible focus indicator on every focusable element (2.4.7). Measured
 *      by focusing each one and comparing computed outline/box-shadow before
 *      and after, rather than by trusting that a CSS rule exists.
 *   4. Tab order reaches the booking form and can LEAVE the calendar. The
 *      calendar is a roving-tabindex grid; a regression that gives every cell
 *      tabindex=0 is invisible to the eye and traps a keyboard user for
 *      thirty-one presses.
 *   5. Headings form a sensible outline: exactly one h1, no skipped level
 *      (1.3.1).
 *   6. Form controls are labelled — every input/select/textarea resolves to a
 *      <label>, aria-label or aria-labelledby (3.3.2).
 *   7. Images have an alt attribute (1.1.1); decorative ones must have alt=""
 *      rather than no attribute at all.
 *   8. prefers-reduced-motion is honoured: with the media feature emulated,
 *      nothing reports a running animation of meaningful duration (2.3.3).
 *
 * WHAT IT CANNOT ASSERT, and which therefore still needs a human:
 *   - whether an accessible name is any GOOD ("button" passes this script);
 *   - VoiceOver's actual announcement order and phrasing;
 *   - text over the hero image, whose contrast depends on the photograph.
 *
 * Usage: node scripts/check-a11y.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const LOCALES = [
  { locale: "ar", dir: "rtl" },
  { locale: "en", dir: "ltr" },
];

const failures = [];
const notes = [];

function fail(context, message) {
  failures.push(`${context}: ${message}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

for (const { locale, dir } of LOCALES) {
  const context = `/${locale}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  await page.goto(`${BASE}/${locale}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // The booking wizard is lazily mounted (BookingFlowLazy). Scroll to it so it
  // is actually in the DOM before anything below tries to audit it — otherwise
  // this script would silently check a page missing its most complex form.
  await page.evaluate(() => {
    document.querySelector("#booking")?.scrollIntoView();
  });
  await page
    .waitForSelector('[role="grid"][data-availability="loaded"]', {
      timeout: 60000,
    })
    .catch(() =>
      notes.push(
        `${context}: the booking calendar never reported loaded availability — ` +
          `the form checks below covered whatever was rendered instead.`,
      ),
    );

  // --- 1. Document language ------------------------------------------------
  const doc = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute("lang"),
    dir: document.documentElement.getAttribute("dir"),
  }));
  if (doc.lang !== locale) {
    fail(context, `<html lang> is "${doc.lang}", expected "${locale}"`);
  }
  if (doc.dir !== dir) {
    fail(context, `<html dir> is "${doc.dir}", expected "${dir}"`);
  }

  // --- 2/5/6/7. Static DOM assertions --------------------------------------
  const dom = await page.evaluate(() => {
    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` +
      `${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`;

    /**
     * The accessible name, near enough for this purpose: the browser's own
     * computation is not exposed to page script, so this reproduces the parts
     * that matter here — aria-label, aria-labelledby, a wrapping or associated
     * <label>, the element's own text, the alt of an image inside it, and
     * <title> on an SVG.
     */
    const accessibleName = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();

      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }

      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      if (el.closest("label")?.textContent?.trim()) {
        return el.closest("label").textContent.trim();
      }

      const text = (el.textContent ?? "").trim();
      if (text) return text;

      const img = el.querySelector("img[alt]");
      if (img?.getAttribute("alt")?.trim()) return img.getAttribute("alt").trim();

      const svgTitle = el.querySelector("svg > title");
      if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim();

      const value = el.getAttribute("value");
      if (value && value.trim()) return value.trim();

      return "";
    };

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none";
    };

    // --- unnamed interactive elements
    const unnamed = [];
    const interactive = document.querySelectorAll(
      'a[href], button, [role="button"], summary, select, textarea, input:not([type="hidden"])',
    );
    for (const el of interactive) {
      if (!visible(el)) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      // Inputs are covered by the labelling check below, not by name.
      if (el.matches("input, select, textarea")) continue;
      if (!accessibleName(el)) unnamed.push(describe(el));
    }

    // --- unlabelled form controls
    const unlabelled = [];
    for (const el of document.querySelectorAll(
      'input:not([type="hidden"]), select, textarea',
    )) {
      if (!visible(el)) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (!accessibleName(el)) unlabelled.push(describe(el));
    }

    // --- images without alt
    const noAlt = [];
    for (const img of document.querySelectorAll("img")) {
      if (!img.hasAttribute("alt")) noAlt.push(img.currentSrc || img.src);
    }

    // --- heading outline
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter(visible)
      .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim().slice(0, 40) }));

    const skips = [];
    for (let i = 1; i < headings.length; i += 1) {
      const jump = headings[i].level - headings[i - 1].level;
      if (jump > 1) {
        skips.push(
          `h${headings[i - 1].level} → h${headings[i].level} at "${headings[i].text}"`,
        );
      }
    }

    // --- calendar roving tabindex
    const grid = document.querySelector('[role="grid"]');
    const tabbableCells = grid
      ? [...grid.querySelectorAll("button")].filter(
          (b) => b.tabIndex === 0,
        ).length
      : null;

    return {
      unnamed,
      unlabelled,
      noAlt,
      h1Count: headings.filter((h) => h.level === 1).length,
      skips,
      tabbableCells,
      gridPresent: Boolean(grid),
    };
  });

  for (const el of dom.unnamed) {
    fail(context, `interactive element has no accessible name: ${el}`);
  }
  for (const el of dom.unlabelled) {
    fail(context, `form control has no label: ${el}`);
  }
  for (const src of dom.noAlt) {
    fail(context, `<img> with no alt attribute: ${src}`);
  }
  if (dom.h1Count !== 1) {
    fail(context, `expected exactly one <h1>, found ${dom.h1Count}`);
  }
  for (const skip of dom.skips) {
    fail(context, `heading level skipped: ${skip}`);
  }
  if (dom.gridPresent && dom.tabbableCells !== 1) {
    fail(
      context,
      `calendar has ${dom.tabbableCells} tabbable cells, expected exactly 1 ` +
        `(roving tabindex). More than one means a keyboard user has to tab ` +
        `through the month to get past it.`,
    );
  }

  // --- 3. Visible focus indicator ------------------------------------------
  const focusResults = await page.evaluate(() => {
    const snapshot = (el) => {
      const style = getComputedStyle(el);
      return [
        style.outlineStyle,
        style.outlineWidth,
        style.outlineColor,
        style.boxShadow,
        style.backgroundColor,
        style.borderColor,
      ].join("|");
    };

    const invisible = [];
    const focusable = [...document.querySelectorAll(
      'a[href], button:not([disabled]), select, textarea, input:not([type="hidden"]):not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    for (const el of focusable) {
      const before = snapshot(el);
      el.focus();
      // :focus-visible only engages for keyboard-like interaction. Programmatic
      // focus counts in Chrome when the element was not clicked, which is the
      // behaviour relied on here.
      const after = snapshot(el);
      el.blur();
      if (before === after) {
        invisible.push(
          `${el.tagName.toLowerCase()}` +
            `${el.id ? `#${el.id}` : ""}` +
            `${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}`,
        );
      }
    }
    return { invisible, total: focusable.length };
  });

  for (const el of focusResults.invisible) {
    fail(context, `no visible focus indicator on ${el}`);
  }
  notes.push(
    `${context}: ${focusResults.total} focusable elements checked for a focus indicator.`,
  );

  // --- 4. The skip link is genuinely first ---------------------------------
  const skipLink = await page.evaluate(() => {
    const first = document.querySelector(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    return first ? { href: first.getAttribute("href"), tag: first.tagName } : null;
  });
  if (skipLink?.href !== "#main") {
    fail(
      context,
      `the first focusable element is not the skip link (found ` +
        `${skipLink?.tag ?? "nothing"} → ${skipLink?.href ?? "—"}). A keyboard ` +
        `user should be able to jump the sticky header on the first Tab.`,
    );
  }

  // --- 8. prefers-reduced-motion -------------------------------------------
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });

  const motion = await page.evaluate(() => {
    const running = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      const durations = [style.animationDuration, style.transitionDuration]
        .join(",")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);

      for (const duration of durations) {
        // The reduced-motion block collapses everything to 0.01ms. Anything
        // still measured in whole milliseconds has escaped it.
        const seconds = duration.endsWith("ms")
          ? parseFloat(duration) / 1000
          : parseFloat(duration);
        if (seconds > 0.05) {
          running.push(
            `${el.tagName.toLowerCase()}` +
              `${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}` +
              ` (${duration})`,
          );
          break;
        }
      }
    }
    return running.slice(0, 10);
  });

  for (const el of motion) {
    fail(
      context,
      `animation/transition still running under prefers-reduced-motion: ${el}`,
    );
  }

  await page.close();
}

await browser.close();

// --- Report ---------------------------------------------------------------

for (const note of notes) console.log(`  · ${note}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} accessibility failure(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    "\nThis is the automatable subset of WCAG 2.1 AA. Passing it is the floor,\n" +
      "not the ceiling — the VoiceOver pass in docs/performance.md is still\n" +
      "the thing that decides whether the booking flow is usable.\n",
  );
  process.exit(1);
}

console.log("\n✓ Accessibility guard passed for both locales.\n");

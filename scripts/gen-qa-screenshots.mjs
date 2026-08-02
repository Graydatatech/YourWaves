/**
 * Captures the QA screenshot set: every customer-facing screen, both locales,
 * three widths, into docs/qa-screenshots/.
 *
 * WHY SCREENSHOTS AND NOT MORE ASSERTIONS
 *
 * The other guards in this directory check things that have a right answer —
 * 44px targets, no overflow, one nav row, a contrast ratio. The RTL failures
 * that actually reach production are not like that. A mirrored layout with a
 * chevron pointing the wrong way, a progress bar that fills from the wrong end,
 * a price whose currency symbol has drifted to the far side of the number: each
 * is perfectly valid HTML with correct measurements, and every one of them is
 * obvious the moment an Arabic reader looks at it.
 *
 * So this produces the artefact a person reviews, and pairs the two locales at
 * matching widths so the comparison is a glance rather than an archaeology
 * exercise.
 *
 * THE ONE THING TO KNOW BEFORE RUNNING IT
 *
 * Point it at a PRODUCTION build (`pnpm build && pnpm start`), not the dev
 * server. Under headless Chrome the dev server's failing HMR socket leaves the
 * page unhydrated, so every interactive component is inert and the wizard never
 * advances past its skeleton — see the phase-9 note in CLAUDE.md, which hit
 * exactly this on the dispatch job sheet.
 *
 * Usage:
 *   node scripts/gen-qa-screenshots.mjs [baseUrl]
 *   DISPATCH_TOKEN=... node scripts/gen-qa-screenshots.mjs   # include /d
 */
import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "docs", "qa-screenshots");

/** 390 is the design target, 768 the tablet break, 1440 the desktop layout. */
const WIDTHS = [390, 768, 1440];
const LOCALES = ["ar", "en"];

/**
 * A dispatch token, if one is available. The job sheet cannot be reached
 * without one — it is a capability URL — so it is captured only when the caller
 * supplies a token from a real fixture (`pnpm dispatch:e2e` prints one).
 */
const DISPATCH_TOKEN = process.env.DISPATCH_TOKEN;

/**
 * Each shot names a step to perform before capturing. The booking wizard is
 * four steps deep on mobile and none of them is reachable by URL, so getting a
 * picture of step 3 means driving the form.
 */
const SHOTS = [
  {
    name: "01-hero",
    path: (locale) => `/${locale}`,
    prepare: async () => {},
  },
  {
    name: "02-how-it-works",
    path: (locale) => `/${locale}#how-it-works`,
    prepare: async (page) => scrollTo(page, "#how-it-works"),
  },
  {
    name: "03-safety-specs",
    path: (locale) => `/${locale}#safety`,
    prepare: async (page) => scrollTo(page, "#safety"),
  },
  {
    name: "04-gallery",
    path: (locale) => `/${locale}#gallery`,
    prepare: async (page) => scrollTo(page, "#gallery"),
  },
  {
    name: "05-booking-calendar",
    path: (locale) => `/${locale}#booking`,
    prepare: async (page) => {
      await scrollTo(page, "#booking");
      await waitForCalendar(page);
    },
  },
  {
    name: "06-booking-time",
    path: (locale) => `/${locale}#booking`,
    prepare: async (page) => {
      await scrollTo(page, "#booking");
      await waitForCalendar(page);
      await pickFirstAvailableDate(page);
      await advanceWizard(page);
    },
  },
  {
    name: "07-booking-summary",
    path: (locale) => `/${locale}#booking`,
    prepare: async (page) => {
      await scrollTo(page, "#booking");
      await waitForCalendar(page);
      await pickFirstAvailableDate(page);
      // The price summary is a bottom sheet on mobile and a sticky card above
      // 900px. Opening the sheet is what makes the two comparable.
      await page
        .click('[data-testid="price-bar-toggle"]')
        .catch(() => {});
    },
  },
  {
    name: "08-faq",
    path: (locale) => `/${locale}#faq`,
    prepare: async (page) => {
      await scrollTo(page, "#faq");
      // One item open, so the disclosure chevron and the panel are both visible.
      await page.evaluate(() => {
        document.querySelector("details")?.setAttribute("open", "");
      });
    },
  },
  {
    name: "09-footer",
    path: (locale) => `/${locale}`,
    prepare: async (page) => scrollTo(page, "footer"),
  },
  {
    name: "10-not-found",
    path: (locale) => `/${locale}/this-page-does-not-exist`,
    prepare: async () => {},
  },
];

// --- helpers ---------------------------------------------------------------

async function scrollTo(page, selector) {
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: "start" });
  }, selector);
  // One frame for the sticky header to settle over the anchor.
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function waitForCalendar(page) {
  await page
    .waitForSelector('[role="grid"][data-availability="loaded"]', {
      timeout: 60000,
    })
    .catch(() => {});
}

async function pickFirstAvailableDate(page) {
  await page
    .click('[data-state="available"]')
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function advanceWizard(page) {
  // The mobile wizard's Next button. Absent above 900px, where both columns are
  // already on screen — hence the swallow.
  await page.click('[data-testid="wizard-next"]').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 400));
}

// --- run -------------------------------------------------------------------

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

const captured = [];
const problems = [];

for (const shot of SHOTS) {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      // deviceScaleFactor 2 so Arabic diacritics and the 11px weekday headers
      // are legible in the artefact — the whole point is that someone can read
      // it without opening the site.
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });

      const url = `${BASE}${shot.path(locale)}`;
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await shot.prepare(page);

        const file = `${shot.name}--${locale}--${width}.png`;
        await page.screenshot({
          path: join(OUT, file),
          // Not fullPage: a full-page shot of the marketing page is 8000px tall
          // and useless for comparing two locales side by side. One viewport,
          // scrolled to the section, is what a reviewer can actually look at.
          fullPage: false,
        });
        captured.push(file);
        console.log(`  ✓ ${file}`);
      } catch (error) {
        problems.push(`${shot.name} ${locale} ${width}: ${error.message}`);
        console.error(`  ✗ ${shot.name} ${locale} ${width}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }
}

// --- the dispatch job sheet, if a token was supplied ------------------------

if (DISPATCH_TOKEN) {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
      const file = `11-job-sheet--${locale}--${width}.png`;
      try {
        await page.goto(`${BASE}/d/${DISPATCH_TOKEN}?lang=${locale}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        captured.push(file);
        console.log(`  ✓ ${file}`);
      } catch (error) {
        problems.push(`job sheet ${locale} ${width}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }
} else {
  console.log(
    "\n  · /d/[token] skipped: no DISPATCH_TOKEN in the environment.\n" +
      "    `pnpm dispatch:e2e` creates a fixture and prints one.",
  );
}

await browser.close();

// --- an index, so the folder is reviewable ---------------------------------

const index = [
  "# QA screenshots",
  "",
  "Generated by `pnpm gen:qa-screenshots` against a production build.",
  "**Do not edit by hand** — re-run the script.",
  "",
  "Each row is one screen at one width, Arabic beside English. Arabic is the",
  "default locale, so it is the left column: it is the one to look at first.",
  "",
  ...WIDTHS.flatMap((width) => [
    `## ${width}px`,
    "",
    "| Screen | Arabic (RTL) | English (LTR) |",
    "| --- | --- | --- |",
    ...SHOTS.filter((shot) =>
      captured.includes(`${shot.name}--ar--${width}.png`),
    ).map(
      (shot) =>
        `| ${shot.name} | ![](${shot.name}--ar--${width}.png) | ![](${shot.name}--en--${width}.png) |`,
    ),
    "",
  ]),
].join("\n");

await writeFile(join(OUT, "README.md"), `${index}\n`);

console.log(
  `\n${captured.length} screenshots in docs/qa-screenshots/ ` +
    `(index written to README.md).`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} shot(s) failed:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

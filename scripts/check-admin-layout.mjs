/**
 * Mobile layout guard for the back office.
 *
 * "The ops person will absolutely be assigning drivers from their phone at a
 * weekend" is a claim about rendered pixels, so it is checked in a real browser
 * at real phone widths rather than asserted from source.
 *
 * The admin pages need a session, which this script cannot mint. So it checks
 * the two screens that ARE reachable signed-out (login and MFA) at full depth,
 * and verifies the structural promises the rest depend on — the bottom tab bar
 * exists below 900px and is replaced by a sidebar above it — by rendering the
 * navigation in isolation via /dev/admin-nav.
 *
 * What this does NOT prove is listed at the bottom of the run.
 *
 * Usage: pnpm check:admin-layout [baseUrl]
 */

import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PHONE_WIDTHS = [320, 360, 390, 414];
const MIN_TARGET = 44;

const failures = [];

function record(ok, label, detail) {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${detail ? `  [2m${detail}[0m` : ""}`,
  );
}

/** Overflow, plus which element caused it. */
async function measure(page, minTarget) {
  return page.evaluate((min) => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;

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

    const small = [];
    for (const el of document.querySelectorAll(
      "a, button, select, input:not([type=hidden]), textarea, summary",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < min - 0.5) {
        small.push(
          `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 18)}" ${Math.round(rect.height)}px`,
        );
      }
    }

    // An input under 16px makes iOS Safari zoom the viewport on focus, which
    // throws the operator out of the form they were filling.
    const tinyText = [];
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size && size < 16) {
        tinyText.push(`${el.tagName.toLowerCase()}#${el.id || "?"} ${size}px`);
      }
    }

    return { overflow, culprit, small, tinyText };
  }, minTarget);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

try {
  // --- The signed-out screens, at every phone width ------------------------
  for (const path of ["/admin/login", "/admin/mfa"]) {
    for (const width of PHONE_WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
      const response = await page.goto(`${BASE}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // /admin/mfa redirects to login when signed out; that IS the correct
      // behaviour, so whichever page renders is the one measured.
      const result = await measure(page, MIN_TARGET);
      const tag = `${path} @${width}px`;

      record(
        result.overflow <= 1,
        `${tag}: no horizontal overflow`,
        result.overflow > 1
          ? `${result.overflow}px, widest: ${result.culprit ?? "unknown"}`
          : `${response.status()}`,
      );
      record(
        result.small.length === 0,
        `${tag}: every control clears ${MIN_TARGET}px`,
        result.small.join("; "),
      );
      record(
        result.tinyText.length === 0,
        `${tag}: no input under 16px`,
        result.tinyText.join("; "),
      );

      await page.close();
    }
  }

  // --- The navigation, which every signed-in screen depends on -------------
  for (const width of [...PHONE_WIDTHS, 900, 1280]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/dev/admin-nav`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const nav = await page.evaluate(() => {
      const tabs = document.querySelector('[data-testid="admin-bottom-tabs"]');
      const sidebar = document.querySelector('[data-testid="admin-sidebar"]');
      const visible = (el) =>
        Boolean(el) && getComputedStyle(el).display !== "none";

      const tabRects = [
        ...document.querySelectorAll('[data-testid="admin-bottom-tabs"] a'),
      ].map((el) => {
        const rect = el.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      });

      return {
        tabsVisible: visible(tabs),
        sidebarVisible: visible(sidebar),
        tabCount: tabRects.length,
        minTabHeight: Math.min(...tabRects.map((r) => r.h), Infinity),
        tabsAtBottom: tabs
          ? Math.abs(tabs.getBoundingClientRect().bottom - window.innerHeight) <
            2
          : false,
      };
    });

    const phone = width < 900;
    record(
      phone ? nav.tabsVisible : !nav.tabsVisible,
      `nav @${width}px: bottom tabs ${phone ? "shown" : "hidden"}`,
      `tabs=${nav.tabsVisible} sidebar=${nav.sidebarVisible}`,
    );
    record(
      phone ? !nav.sidebarVisible : nav.sidebarVisible,
      `nav @${width}px: sidebar ${phone ? "hidden" : "shown"}`,
    );

    if (phone) {
      record(
        nav.tabCount === 4,
        `nav @${width}px: four destinations`,
        `${nav.tabCount}`,
      );
      record(
        nav.tabsAtBottom,
        `nav @${width}px: tabs are pinned to the bottom, under the thumb`,
      );
      record(
        nav.minTabHeight >= MIN_TARGET,
        `nav @${width}px: each tab clears ${MIN_TARGET}px`,
        `${nav.minTabHeight}px`,
      );
    }

    await page.close();
  }
} finally {
  await browser.close();
}

console.log(
  "\nnotes:\n" +
    "  The signed-in screens (overview, calendar, orders, booking detail,\n" +
    "  settings) are NOT measured here — they need a Supabase session this\n" +
    "  script cannot mint. Their layouts follow the same rules and the shared\n" +
    "  navigation is verified above, but that is an argument, not a measurement.\n" +
    "  Re-run this against a signed-in session once Supabase Auth is configured.",
);

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}`
    : "\nall checks passed",
);
process.exit(failures.length ? 1 : 0);

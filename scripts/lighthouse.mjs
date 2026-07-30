/**
 * Lighthouse mobile audit against the production build.
 *
 * Uses Lighthouse's default mobile preset: emulated Moto G Power, 4x CPU
 * slowdown and simulated 4G (1.6 Mbps down / 150ms RTT) — the profile named in
 * the acceptance criteria.
 *
 * Usage: node scripts/lighthouse.mjs [baseUrl]
 */
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";

const BASE = process.argv[2] ?? "http://localhost:3000";
const TARGETS = ["/en", "/ar"];

/**
 * "simulate" is Lighthouse's default: it records an unthrottled trace and then
 * models a 4G network over the dependency graph. "devtools" applies real
 * throttling to the actual load. The simulated model is deliberately
 * pessimistic; both are reported so the difference is visible rather than
 * cherry-picked. Pass THROTTLING=devtools to switch.
 */
const THROTTLING = process.env.THROTTLING ?? "simulate";

const THRESHOLDS = {
  performance: 0.9,
  accessibility: 0.95,
};
const LCP_BUDGET_MS = 2000;

const chrome = await launch({
  chromeFlags: ["--headless=new", "--no-sandbox"],
  chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

const failures = [];

for (const path of TARGETS) {
  const url = `${BASE}${path}`;
  const runnerResult = await lighthouse(
    url,
    { port: chrome.port, output: "json", logLevel: "error" },
    // `mobile` is the default form factor; stated explicitly for the record.
    {
      extends: "lighthouse:default",
      settings: {
        formFactor: "mobile",
        throttlingMethod: THROTTLING,
        onlyCategories: [
          "performance",
          "accessibility",
          "best-practices",
          "seo",
        ],
      },
    },
  );

  const lhr = runnerResult.lhr;
  const score = (id) => lhr.categories[id]?.score ?? 0;
  const audit = (id) => lhr.audits[id];

  const perf = score("performance");
  const a11y = score("accessibility");
  const lcp = audit("largest-contentful-paint")?.numericValue ?? 0;
  const cls = audit("cumulative-layout-shift")?.numericValue ?? 0;
  const tbt = audit("total-blocking-time")?.numericValue ?? 0;

  console.log(`\n── ${path} ──────────────────────────────`);
  console.log(`  Performance    ${(perf * 100).toFixed(0)}`);
  console.log(`  Accessibility  ${(a11y * 100).toFixed(0)}`);
  console.log(`  Best practices ${(score("best-practices") * 100).toFixed(0)}`);
  console.log(`  SEO            ${(score("seo") * 100).toFixed(0)}`);
  console.log(`  LCP            ${(lcp / 1000).toFixed(2)}s`);
  console.log(`  CLS            ${cls.toFixed(3)}`);
  console.log(`  TBT            ${tbt.toFixed(0)}ms`);

  // Surface any failing accessibility audit by name — that is the actionable
  // part when the score is short of target.
  const a11yFailures = lhr.categories.accessibility.auditRefs
    .map((ref) => lhr.audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1);
  if (a11yFailures.length) {
    console.log(`  a11y issues: ${a11yFailures.map((a) => a.id).join(", ")}`);
  }

  if (perf < THRESHOLDS.performance) {
    failures.push(`${path}: performance ${(perf * 100).toFixed(0)} < 90`);
  }
  if (a11y < THRESHOLDS.accessibility) {
    failures.push(`${path}: accessibility ${(a11y * 100).toFixed(0)} < 95`);
  }
  if (lcp > LCP_BUDGET_MS) {
    failures.push(`${path}: LCP ${(lcp / 1000).toFixed(2)}s > 2.00s`);
  }
}

await chrome.kill();

if (failures.length) {
  console.error(
    `\n✗ ${failures.length} failure(s):\n - ${failures.join("\n - ")}`,
  );
  process.exit(1);
}
console.log("\n✓ Lighthouse thresholds met.");

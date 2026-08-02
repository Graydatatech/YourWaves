/**
 * First-load JavaScript budget, enforced against a real production build.
 *
 * WHAT IT MEASURES
 *
 * The bytes a browser must download and execute before the route is
 * interactive: every chunk Next lists for the route in
 * `.next/app-build-manifest.json`, plus the shared framework/main chunks from
 * `.next/build-manifest.json`, de-duplicated, GZIPPED.
 *
 * Gzipped, because the raw byte count is not a number any user experiences and
 * a budget in raw bytes rewards the wrong changes — adding a hundred repetitive
 * class names costs almost nothing on the wire, while pulling in one small
 * library with a distinct vocabulary costs a lot. Brotli would be closer still
 * to what a CDN serves, but gzip is in Node's standard library and the ratio
 * between the two is stable enough that the DELTA, which is what a budget
 * actually polices, is the same either way.
 *
 * HOW THE BUDGET IS SET
 *
 * `bundle-budget.json` at the repository root, committed. It is a ratchet, not
 * an aspiration: run `node scripts/check-bundle.mjs --update` to write the
 * current sizes after a change you have decided is worth it, and commit the
 * diff so the increase is reviewed like any other. A budget nobody ever
 * updates gets bypassed; a budget whose changes appear in the diff gets
 * discussed.
 *
 * Usage:
 *   node scripts/check-bundle.mjs            # check (exit 1 over budget)
 *   node scripts/check-bundle.mjs --update   # re-baseline
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, ".next");
const BUDGET_FILE = join(ROOT, "bundle-budget.json");
const UPDATE = process.argv.includes("--update");

/**
 * Routes worth policing, and why each one.
 *
 * Not every route: a budget on a page nobody's phone loads is noise that
 * eventually gets ignored. These three are the ones where bytes cost money.
 */
const WATCHED = [
  {
    route: "/[locale]/page",
    label: "marketing page (/ar, /en)",
    why: "The 4G villa page. Every visitor pays this before anything works.",
  },
  {
    route: "/[locale]/booking/success/[reference]/page",
    label: "booking success",
    why: "Loaded straight after payment, often on a worse connection than the booking itself.",
  },
  {
    route: "/d/[token]/page",
    label: "dispatch job sheet",
    why: "A driver, in a car, in a villa driveway. The least forgiving network on the project.",
  },
];

/** Default ceiling for a route with no recorded baseline yet, in KB gzipped. */
const DEFAULT_BUDGET_KB = 200;

/**
 * How much a route may grow before this fails, once it HAS a baseline.
 * 2% absorbs the ordinary noise of a dependency patch bump without absorbing a
 * real regression.
 */
const TOLERANCE = 1.02;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function gzippedSize(relativePath) {
  const path = join(NEXT_DIR, relativePath);
  try {
    const bytes = await readFile(path);
    return gzipSync(bytes, { level: 9 }).length;
  } catch {
    return 0;
  }
}

// --- Preflight ------------------------------------------------------------

try {
  await stat(NEXT_DIR);
} catch {
  console.error(
    "No .next directory. This measures a PRODUCTION build, not a dev server:\n" +
      "  pnpm build && pnpm check:bundle",
  );
  process.exit(1);
}

const appManifest = await readJson(join(NEXT_DIR, "app-build-manifest.json"));
const buildManifest = await readJson(join(NEXT_DIR, "build-manifest.json"));

if (!appManifest?.pages) {
  console.error(
    ".next/app-build-manifest.json is missing or has no `pages` key.\n" +
      "That file is written by `next build`; a dev server does not produce it.\n" +
      "If the build succeeded and this still fails, the manifest shape has\n" +
      "changed in a Next.js upgrade and this script needs updating.",
  );
  process.exit(1);
}

/**
 * Chunks every route loads regardless — the framework, the runtime, the shared
 * commons. Counted once per route, because a browser does download them once
 * per route on a cold visit, which is the case the budget exists for.
 */
const sharedChunks = new Set(buildManifest?.rootMainFiles ?? []);

const baseline = (await readJson(BUDGET_FILE)) ?? { routes: {} };
const results = [];
const failures = [];

for (const target of WATCHED) {
  const chunks = appManifest.pages[target.route];

  if (!chunks) {
    // A renamed or deleted route should be loud: a silently-unmeasured route
    // is how a budget quietly stops covering the thing it was written for.
    failures.push(
      `${target.label}: route "${target.route}" is not in the build manifest. ` +
        `Was it renamed? Update WATCHED in scripts/check-bundle.mjs.`,
    );
    continue;
  }

  const unique = new Set([...sharedChunks, ...chunks]);
  let total = 0;
  for (const chunk of unique) {
    // CSS is not JavaScript and is not what this budget is about.
    if (!chunk.endsWith(".js")) continue;
    total += await gzippedSize(chunk);
  }

  const kb = total / 1024;
  const recorded = baseline.routes?.[target.route]?.gzipKb;
  const budgetKb = recorded ?? DEFAULT_BUDGET_KB;
  const ceiling = recorded ? recorded * TOLERANCE : DEFAULT_BUDGET_KB;

  results.push({ ...target, kb, budgetKb, recorded, ceiling });

  if (kb > ceiling) {
    failures.push(
      `${target.label}: ${kb.toFixed(1)} KB gzipped, over the ${ceiling.toFixed(1)} KB ceiling` +
        (recorded
          ? ` (baseline ${recorded.toFixed(1)} KB + ${((TOLERANCE - 1) * 100).toFixed(0)}%)`
          : ` (no baseline yet; default ${DEFAULT_BUDGET_KB} KB)`),
    );
  }
}

// --- Report ---------------------------------------------------------------

console.log("\nFirst-load JavaScript, gzipped\n");
for (const result of results) {
  const delta =
    result.recorded === undefined
      ? "  (no baseline)"
      : `  ${result.kb >= result.recorded ? "+" : ""}${(result.kb - result.recorded).toFixed(1)} KB`;
  const status = failures.some((f) => f.startsWith(result.label)) ? "✗" : "✓";
  console.log(
    `  ${status} ${result.label.padEnd(28)} ${result.kb.toFixed(1).padStart(7)} KB${delta}`,
  );
  console.log(`      ${result.why}`);
}

if (UPDATE) {
  const next = {
    // A note in the file itself, because the person who finds this in a diff
    // will not have read this script.
    _: "Gzipped first-load JS per route, in KB. Written by `node scripts/check-bundle.mjs --update`. An increase here is a deliberate decision — review it like code.",
    routes: Object.fromEntries(
      results.map((result) => [
        result.route,
        { label: result.label, gzipKb: Number(result.kb.toFixed(1)) },
      ]),
    ),
  };
  await writeFile(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\nBaseline written to bundle-budget.json. Commit it.`);
  process.exit(0);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} budget failure(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    `\nIf the increase is intended, re-baseline and commit the change:\n` +
      `  node scripts/check-bundle.mjs --update`,
  );
  process.exit(1);
}

console.log("\nAll routes within budget.\n");

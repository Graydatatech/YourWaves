/**
 * WCAG contrast audit of the design tokens.
 *
 * Reads the hex values straight out of `src/app/globals.css` and
 * `src/lib/notifications/templates/theme.ts` rather than duplicating them here,
 * so this cannot pass while the tokens say something else. Needs no browser and
 * no build — it is arithmetic on the source of truth, which is why it can run
 * in a pre-commit hook where a Lighthouse run cannot.
 *
 * WHAT IT CHECKS THAT A BROWSER AUDIT DOES NOT
 *
 * Lighthouse and axe sample the colours that are actually painted on the page
 * they happen to load. That misses two things this catches:
 *
 *   - a token used somewhere the audit did not visit;
 *   - a token that passes on the surface it was DESIGNED against but fails on
 *     the surface it is actually used on. That is the entire phase-10 finding:
 *     the muted ramp was solved against white, and `<html>` paints a gradient
 *     bottoming out at #e1edf4 with a radial peaking at #d3ecf6. Against those,
 *     --muted-2 measured 4.13:1 and --muted-3 3.70:1.
 *
 * It is not a replacement for a browser pass — it knows nothing about which
 * pairs actually occur, or about text over images. It is the floor.
 *
 * Usage: node scripts/check-contrast.mjs
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();

// --- Colour maths ---------------------------------------------------------

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Read the tokens ------------------------------------------------------

const css = await readFile(join(ROOT, "src/app/globals.css"), "utf8");
const emailTheme = await readFile(
  join(ROOT, "src/lib/notifications/templates/theme.ts"),
  "utf8",
);
const statusPill = await readFile(
  join(ROOT, "src/app/admin/components/StatusPill.tsx"),
  "utf8",
);

/** `--name: #rrggbb;` → { name: "#rrggbb" }. Only plain hex values. */
function cssTokens(source) {
  const tokens = {};
  const pattern = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tokens[`--${match[1]}`] = match[2].toLowerCase();
  }
  return tokens;
}

/** `name: "#rrggbb",` → { name: "#rrggbb" }. */
function tsTokens(source) {
  const tokens = {};
  const pattern = /^\s*([a-zA-Z0-9]+):\s*"(#[0-9a-fA-F]{6})"/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tokens[match[1]] = match[2].toLowerCase();
  }
  return tokens;
}

/**
 * The admin status pills, read out of the component.
 *
 * These are literal hex in a Tailwind arbitrary value rather than tokens —
 * legitimately, because a dense ops screen wants a flatter palette than the
 * marketing site — which means each pill is its OWN contrast question and no
 * token audit covers them. `expired` was 4.34:1 until phase 10 for exactly that
 * reason: nothing else on the site pairs that grey with that tint.
 *
 * Matches `bg-[#rrggbb] text-[#rrggbb]` in that order. The component carries a
 * comment saying so.
 */
function pillPairs(source) {
  const pairs = [];
  const row = /(\w+):\s*"bg-\[(#[0-9a-fA-F]{6})\]\s+text-\[(#[0-9a-fA-F]{6})\]/g;
  let match;
  while ((match = row.exec(source)) !== null) {
    pairs.push({ name: match[1], bg: match[2].toLowerCase(), fg: match[3].toLowerCase() });
  }
  return pairs;
}

const token = cssTokens(css);
const mail = tsTokens(emailTheme);
const pills = pillPairs(statusPill);

if (pills.length === 0) {
  console.error(
    "No status-pill colour pairs were found in StatusPill.tsx.\n" +
      "The TONE map's `bg-[#…] text-[#…]` shape is what this parses. If it was\n" +
      "refactored, update pillPairs() — do not just delete this check, or the\n" +
      "admin palette goes back to being audited by nobody.",
  );
  process.exit(1);
}

// --- What must hold -------------------------------------------------------

const AA_TEXT = 4.5; // WCAG 1.4.3, text below 18.66px (or below 14pt bold)
const AA_LARGE = 3.0; // 1.4.3 for large text
const AA_NON_TEXT = 3.0; // 1.4.11 icons, borders; 2.4.11 focus indicators

/**
 * The surfaces a colour can land on.
 *
 * The page gradient is three stops plus a radial, and text sits on all of them,
 * so the two darkest are checked rather than an average. #d3ecf6 is the radial
 * peak: only reachable in the top ~590px, which is header and hero territory,
 * but the header is a translucent panel over exactly that, so its links do sit
 * on it.
 */
const SITE_SURFACES = [
  ["--surface (white)", "#ffffff"],
  ["page gradient, mid", "#e9f3f8"],
  ["page gradient, darkest", "#e1edf4"],
  ["page radial peak", "#d3ecf6"],
];

const DARK_SURFACES = [
  ["--footer", token["--footer"] ?? "#04202f"],
  ["dark panel", "#0a2c46"],
  ["hero scrim, bottom", "#0a1219"],
];

const EMAIL_SURFACES = [
  ["email surface", mail.surface ?? "#ffffff"],
  ["email page", mail.page ?? "#eef5f9"],
  ["email panel", mail.panel ?? "#f3f9fc"],
  ["email warningBg", mail.warningBg ?? "#fff7ed"],
  ["email dangerBg", mail.dangerBg ?? "#fdeceb"],
];

/**
 * Every check is a claim about how the colour is USED, not just what it is.
 * That is the part a generic linter cannot know and the part that goes stale,
 * so each one carries its rationale.
 */
const CHECKS = [
  // --- Site body text, on every light surface it can land on --------------
  ...["--ink", "--muted", "--muted-2", "--muted-3", "--accent-strong"].flatMap(
    (name) =>
      SITE_SURFACES.map(([label, bg]) => ({
        group: "site text",
        name,
        fg: token[name],
        bgLabel: label,
        bg,
        min: AA_TEXT,
        note: "small text",
      })),
  ),

  // --- Error copy. The message a user most needs to read. -----------------
  ...SITE_SURFACES.map(([label, bg]) => ({
    group: "site text",
    name: "--danger",
    fg: token["--danger"],
    bgLabel: label,
    bg,
    min: AA_TEXT,
    note: "form error text",
  })),
  {
    group: "site text",
    name: "--danger",
    fg: token["--danger"],
    bgLabel: "--danger-surface",
    bg: token["--danger-surface"],
    min: AA_TEXT,
    note: "error text inside its own tint",
  },

  // --- --accent is explicitly NOT a text colour ---------------------------
  ...SITE_SURFACES.map(([label, bg]) => ({
    group: "non-text",
    name: "--accent",
    fg: token["--accent"],
    bgLabel: label,
    bg,
    min: AA_NON_TEXT,
    note: "icons, fills, borders only — never small text (see --accent-strong)",
  })),

  // --- Focus indicator, both halves of the pair ---------------------------
  ...SITE_SURFACES.map(([label, bg]) => ({
    group: "focus ring",
    name: "--accent-strong (default ring)",
    fg: token["--accent-strong"],
    bgLabel: label,
    bg,
    min: AA_NON_TEXT,
    note: "WCAG 2.4.11",
  })),
  ...DARK_SURFACES.map(([label, bg]) => ({
    group: "focus ring",
    name: "--accent-light (.on-dark ring)",
    fg: token["--accent-light"],
    bgLabel: label,
    bg,
    min: AA_NON_TEXT,
    note: "WCAG 2.4.11 — why .on-dark exists",
  })),

  // --- Text on the brand gradient -----------------------------------------
  {
    group: "brand",
    name: "--ink-deep on brand teal",
    fg: token["--ink-deep"],
    bgLabel: "brand gradient, lightest stop #22e0d6",
    bg: "#22e0d6",
    min: AA_TEXT,
    note: "CTA label. Checked against the LIGHTEST stop — the worst case.",
  },

  // --- Email palette, on every email surface -------------------------------
  ...["ink", "muted", "muted2", "accentStrong", "danger", "warning"].flatMap(
    (name) =>
      EMAIL_SURFACES.map(([label, bg]) => ({
        group: "email text",
        name: `email.${name}`,
        fg: mail[name],
        bgLabel: label,
        bg,
        min: AA_TEXT,
        note: "email body copy",
      })),
  ),
  // --- Admin status pills, each on its own tint ----------------------------
  ...pills.map((pill) => ({
    group: "admin status pills",
    name: `StatusPill.${pill.name}`,
    fg: pill.fg,
    bgLabel: pill.bg,
    bg: pill.bg,
    min: AA_TEXT,
    note: "pill label — small bold text on its own tint",
  })),

  {
    group: "email",
    name: "email.inkDeep on brandSolid",
    fg: mail.inkDeep,
    bgLabel: "email.brandSolid (the Outlook fallback)",
    bg: mail.brandSolid,
    min: AA_TEXT,
    note: "Word ignores the gradient, so the SOLID is what Outlook users read.",
  },
];

// --- Run ------------------------------------------------------------------

const failures = [];
const missing = [];
const byGroup = new Map();

for (const check of CHECKS) {
  if (!check.fg || !check.bg) {
    missing.push(`${check.name} on ${check.bgLabel}`);
    continue;
  }
  const value = ratio(check.fg, check.bg);
  const pass = value >= check.min;
  if (!pass) failures.push({ ...check, value });

  if (!byGroup.has(check.group)) byGroup.set(check.group, []);
  byGroup.get(check.group).push({ ...check, value, pass });
}

for (const [group, rows] of byGroup) {
  console.log(`\n── ${group} ${"─".repeat(Math.max(0, 46 - group.length))}`);
  for (const row of rows) {
    console.log(
      `  ${row.pass ? "✓" : "✗"} ${row.value.toFixed(2).padStart(5)}:1  ` +
        `(min ${row.min})  ${row.name} on ${row.bgLabel}`,
    );
  }
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} token(s) could not be read from source — a rename, or ` +
      `a value that is no longer a plain hex:\n`,
  );
  for (const name of missing) console.error(`  ? ${name}`);
}

if (failures.length > 0 || missing.length > 0) {
  console.error(`\n${failures.length} contrast failure(s):\n`);
  for (const failure of failures) {
    console.error(
      `  ✗ ${failure.name} on ${failure.bgLabel}: ` +
        `${failure.value.toFixed(2)}:1, needs ${failure.min}:1 — ${failure.note}`,
    );
  }
  console.error(
    "\nDarken the token rather than the usage: a one-off override fixes the " +
      "\nscreen you were looking at and leaves every other use of it failing.\n",
  );
  process.exit(1);
}

console.log(
  `\n${CHECKS.length} pairs checked, all pass. ` +
    `(AA text ${AA_TEXT}:1, large ${AA_LARGE}:1, non-text ${AA_NON_TEXT}:1)\n`,
);

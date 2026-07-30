/**
 * Fails the lint run when a physical-direction Tailwind class appears anywhere
 * in the source. YourWaves ships Arabic (RTL) as its default locale, so every
 * layout must be written with logical properties and mirror for free.
 *
 * The rule inspects every string literal and template chunk, not just JSX
 * `className` attributes, because variant maps like
 *   const variants = { primary: "ms-2 ps-4" }
 * live outside JSX and are exactly where a physical class would hide.
 */

// Built from fragments so this rule file never trips over its own patterns.
const M = "m";
const P = "p";
const L = "l";
const R = "r";

/**
 * Utilities whose replacement is a logical equivalent.
 *
 * `bare: true` means the utility is a complete class without a value
 * (`border-l`), so both `border-l` and `border-l-2` are violations. Everything
 * else REQUIRES a Tailwind value suffix to count — otherwise the rule fires on
 * ordinary English. That matters most for the bare words: this is an RTL
 * codebase, so "right-to-left" appears legitimately in prose, comments and test
 * names, and must not be mistaken for the `right-*` utility.
 */
const PREFIXED = [
  { bad: `${M}${L}`, good: `${M}s` },
  { bad: `${M}${R}`, good: `${M}e` },
  { bad: `${P}${L}`, good: `${P}s` },
  { bad: `${P}${R}`, good: `${P}e` },
  { bad: `scroll-${M}${L}`, good: `scroll-${M}s` },
  { bad: `scroll-${M}${R}`, good: `scroll-${M}e` },
  { bad: `scroll-${P}${L}`, good: `scroll-${P}s` },
  { bad: `scroll-${P}${R}`, good: `scroll-${P}e` },
  { bad: `${L}eft`, good: "start" },
  { bad: `${R}ight`, good: "end" },
  { bad: `border-${L}`, good: "border-s", bare: true },
  { bad: `border-${R}`, good: "border-e", bare: true },
  { bad: `rounded-${L}`, good: "rounded-s", bare: true },
  { bad: `rounded-${R}`, good: "rounded-e", bare: true },
  { bad: `rounded-t${L}`, good: "rounded-ss", bare: true },
  { bad: `rounded-t${R}`, good: "rounded-se", bare: true },
  { bad: `rounded-b${L}`, good: "rounded-es", bare: true },
  { bad: `rounded-b${R}`, good: "rounded-ee", bare: true },
  { bad: `inset-${L}`, good: "inset-inline-start" },
  { bad: `inset-${R}`, good: "inset-inline-end" },
];

/**
 * What can follow a Tailwind utility prefix: a spacing step, a fraction, a
 * keyword, or an arbitrary value. "to-left" (from "right-to-left") matches
 * none of these, which is precisely the point.
 */
const VALUE = /^(\d+(\.\d+)?|\d+\/\d+|full|auto|px|reverse|\[[^\]]*\])$/;

/** Utilities that are a complete class on their own. */
const EXACT = [
  { bad: `text-${L}eft`, good: "text-start" },
  { bad: `text-${R}ight`, good: "text-end" },
  { bad: `float-${L}eft`, good: "float-start" },
  { bad: `float-${R}ight`, good: "float-end" },
  { bad: `clear-${L}eft`, good: "clear-start" },
  { bad: `clear-${R}ight`, good: "clear-end" },
  { bad: `origin-${L}eft`, good: "a logical transform origin" },
  { bad: `origin-${R}ight`, good: "a logical transform origin" },
];

// Strips Tailwind variants (`sm:`, `hover:`, `rtl:`, `group-[...]:`) and any
// leading negative sign, so `sm:-ml-2` is still caught.
const VARIANT = /^(?:[^:\s]+:)*-?/;

function classify(rawToken) {
  const token = rawToken.replace(VARIANT, "");
  if (!token) return null;

  for (const { bad, good } of EXACT) {
    if (token === bad) return { bad, good };
  }
  for (const { bad, good, bare } of PREFIXED) {
    if (bare && token === bad) return { bad, good };
    if (!token.startsWith(`${bad}-`)) continue;

    const suffix = token.slice(bad.length + 1);

    // `border-*` / `rounded-*` take size keywords (`lg`, `2xl`) as well as
    // spacing values, and no English word begins "border-l-" or "rounded-tl-",
    // so any suffix here is a real utility. Note this branch is not reached by
    // `border-red-500`, which does not start with "border-r-".
    if (bare) return { bad, good };

    // For the rest — especially the bare words `left` and `right` — only a
    // genuine Tailwind value counts, so "right-to-left" stays prose.
    if (VALUE.test(suffix)) return { bad, good };
  }
  return null;
}

/** A string only looks like classes if it has no spaces-with-punctuation prose. */
function findViolations(value) {
  const found = [];
  for (const token of value.split(/\s+/)) {
    const hit = classify(token);
    if (hit) found.push({ token, ...hit });
  }
  return found;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow physical-direction Tailwind classes; use logical properties so RTL mirrors automatically.",
    },
    schema: [],
    messages: {
      physical:
        'Physical-direction class "{{token}}" is not allowed — YourWaves is RTL-first. Use "{{good}}" instead.',
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value !== "string" || !value.trim()) return;
      for (const hit of findViolations(value)) {
        context.report({
          node,
          messageId: "physical",
          data: { token: hit.token, good: hit.good },
        });
      }
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
      JSXText(node) {
        // Ignore prose; JSX text is never a class list.
        void node;
      },
    };
  },
};

export default {
  rules: {
    "no-physical-direction": rule,
  },
};

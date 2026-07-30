/**
 * Generates docs/whatsapp-templates.md from the WhatsApp parameter contract.
 *
 * The client has to submit each of these to Meta by hand, and every one has a
 * positional body ({{1}}, {{2}}, …) whose order MUST match the order the worker
 * sends parameters in. Writing that document by hand guarantees it drifts: a
 * parameter added in code and forgotten in the doc produces an approved
 * template that renders "your booking for +974 5512 3456 at Al Waab".
 *
 * So the doc is generated from the same two sources the code uses — the ordered
 * param list in src/lib/notifications/templates/index.ts, and the message
 * catalogue — and regenerating it is part of the phase's verification.
 *
 * Both this generator and the registry read the ORDER from
 * src/lib/notifications/templates/whatsapp-params.json. Keeping it as plain
 * data rather than parsing the TypeScript is deliberate: the registry is a
 * `server-only` module a doc generator has no business importing, and two
 * earlier attempts to regex the order out of the source both got it wrong —
 * silently, which is the worst way for this particular fact to be wrong.
 *
 * Usage: pnpm gen:whatsapp-templates
 */

import { readFileSync, writeFileSync } from "node:fs";

const CONTRACT_PATH = "src/lib/notifications/templates/whatsapp-params.json";
const OUT = "docs/whatsapp-templates.md";

const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")).notifications;
const en = JSON.parse(readFileSync("messages/en.json", "utf8")).notifications;
const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

/** Reads `notifications.a.b.c` out of a catalogue. */
function messageAt(catalogue, dottedKey) {
  return dottedKey
    .split(".")
    .reduce((node, part) => (node == null ? undefined : node[part]), catalogue);
}

const definitions = Object.entries(CONTRACT.templates).map(
  ([templateName, entry]) => ({
    templateName,
    messageKey: entry.messageKey,
    params: entry.params,
  }),
);

/** "Hello {name}, your {thing}" + [name, thing] → "Hello {{1}}, your {{2}}" */
function toPositional(message, params) {
  let output = message;
  params.forEach((name, index) => {
    output = output.split(`{${name}}`).join(`{{${index + 1}}}`);
  });
  return output;
}

/** Any placeholder left over means the param list and the copy disagree. */
function unresolvedPlaceholders(body) {
  return [...body.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]);
}

if (definitions.length === 0) {
  console.error(`No templates found in ${CONTRACT_PATH}.`);
  process.exit(1);
}

const problems = [];
const warnings = [];
const sections = [];

for (const definition of definitions) {
  const enMessage = messageAt(en, definition.messageKey);
  const arMessage = messageAt(ar, definition.messageKey);

  if (!enMessage || !arMessage) {
    problems.push(
      `${definition.templateName}: missing catalogue entry ${definition.messageKey} (en=${Boolean(enMessage)}, ar=${Boolean(arMessage)})`,
    );
    continue;
  }

  const enBody = toPositional(enMessage, definition.params);
  const arBody = toPositional(arMessage, definition.params);

  for (const [locale, body] of [
    ["en", enBody],
    ["ar", arBody],
  ]) {
    const leftover = unresolvedPlaceholders(body);
    if (leftover.length > 0) {
      problems.push(
        `${definition.templateName} (${locale}): copy uses {${leftover.join("}, {")}} which is not in the params list`,
      );
    }
  }

  /**
   * Meta requires placeholders to run 1..N with no gaps, and rejects a send
   * whose parameter count differs from the approved body. A declared parameter
   * the copy never uses produces both faults at once, so this is an error, not
   * a warning — it is exactly the (#132000) documented at the bottom of the
   * generated file.
   */
  const unused = definition.params.filter(
    (name) =>
      !enMessage.includes(`{${name}}`) || !arMessage.includes(`{${name}}`),
  );
  if (unused.length > 0) {
    problems.push(
      `${definition.templateName}: declares {${unused.join("}, {")}} but the copy does not use ` +
        `${unused.length > 1 ? "them" : "it"} in both languages — Meta needs gapless {{1}}..{{n}}`,
    );
  }

  for (const [locale, body] of [
    ["en", enBody],
    ["ar", arBody],
  ]) {
    for (let index = 1; index <= definition.params.length; index += 1) {
      if (!body.includes(`{{${index}}}`)) {
        problems.push(
          `${definition.templateName} (${locale}): {{${index}}} is missing — placeholders must be sequential`,
        );
      }
    }
    // Not known to be rejected outright, but Meta's editor warns about it and
    // some reviewers reject it, so it is surfaced rather than silently shipped.
    if (/\{\{\d+\}\}\s*$/.test(body)) {
      warnings.push(
        `${definition.templateName} (${locale}): body ends with a placeholder; Meta's editor flags this`,
      );
    }
  }

  sections.push(
    [
      `### \`${definition.templateName}\``,
      "",
      "| | |",
      "| --- | --- |",
      "| **Category** | `UTILITY` |",
      "| **Languages** | `en`, `ar` |",
      `| **Body parameters** | ${definition.params.length} |`,
      `| **Parameter order** | ${definition.params.map((name, i) => `\`{{${i + 1}}}\` = ${name}`).join(", ")} |`,
      "",
      "**English body**",
      "",
      "```",
      enBody,
      "```",
      "",
      "**Arabic body**",
      "",
      "```",
      arBody,
      "```",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
}

const header = `<!-- GENERATED FILE — do not edit by hand.
     Run \`pnpm gen:whatsapp-templates\` after changing either
     src/lib/notifications/templates/whatsapp-params.json or the
     \`notifications\` namespace in messages/{ar,en}.json. -->

# WhatsApp message templates — what the client must submit to Meta

Every one of these must exist and be **approved** in the client's WhatsApp
Business account before phase 7 can send anything. Until then
\`WHATSAPP_PROVIDER=console\` prints the messages instead, and a production
deployment refuses to start with the console transport.

Provisioning the business account, verifying the business and paying for
messages are the **client's responsibility** under the SRS operational notice —
the same boundary as the OTP template in
[whatsapp-setup.md](whatsapp-setup.md) and the payment merchant account in
[payments-setup.md](payments-setup.md).

## Before you start

1. Meta Business Manager → **business verification must be complete**. Template
   creation is gated behind Advanced Access; an unverified business gets
   \`(#10) subcode 2388185\` when it tries. This blocked the phase-4 OTP
   template too — see whatsapp-setup.md.
2. WhatsApp Manager → **Message templates** → *Create template*.
3. Category **UTILITY** for all of these. They are transactional messages about
   a booking the customer has paid for, not marketing. Submitting them as
   MARKETING invites rejection and costs more per message.
4. Create each template **twice**, once per language, under the same name. Meta
   treats \`en\` and \`ar\` as localisations of one template.

## How the parameters work

The bodies below use Meta's positional placeholders. **The numbering is the
contract**: \`{{1}}\` is filled with whatever the code sends first. The order in
each table is generated from the code that sends it, so as long as the body is
copied verbatim the two cannot disagree.

Do **not** reorder placeholders while translating. Arabic word order often wants
a different sequence than English, but both localisations receive the same
positional array — swapping \`{{2}}\` and \`{{3}}\` in the Arabic body puts the
date where the time should be. Rephrase around the order instead.

## Templates

`;

const footer = `
## After approval

Set in the deployment environment:

\`\`\`bash
WHATSAPP_PROVIDER=cloud
WHATSAPP_PHONE_NUMBER_ID=...     # same number as the OTP sender
WHATSAPP_ACCESS_TOKEN=...        # a permanent System User token, not a 24h one
\`\`\`

Then send one real booking through and check the notifications log
(\`GET /api/admin/notifications\`) shows \`sent\` for both channels.

## If a send fails

The error is recorded on the row in \`last_error\` and visible in the log. The
common ones:

| Meta error | Meaning | Fix |
| --- | --- | --- |
| \`(#132000)\` | Parameter count mismatch | The approved body has a different number of \`{{n}}\` than the code sends. Regenerate this file and compare. |
| \`(#132001)\` | Template does not exist | Name or language code differs from the table above. |
| \`(#132015)\` | Template paused for quality | Too many users blocked or reported it. Meta pauses it automatically; revise the copy. |
| \`(#131030)\` | Recipient not in allow-list | The number is not on the test allow-list and the account is still in development mode. |
| \`(#131047)\` | Re-engagement required | Only applies to free-form sends. If this appears, something is bypassing the template path. |

A \`4xx\` from Meta is treated as **permanent** by the worker: it stops
immediately rather than spending the full retry ladder discovering the template
name is still wrong, and alerts an admin.
`;

writeFileSync(OUT, header + sections.join("\n") + footer, "utf8");

console.log(`✓ ${OUT} — ${definitions.length} templates`);
for (const definition of definitions) {
  console.log(
    `  ${definition.templateName.padEnd(26)} ${definition.params.length} params`,
  );
}

if (warnings.length > 0) {
  console.warn(`\n⚠ ${warnings.length} warning(s):`);
  for (const warning of warnings) console.warn(`  ${warning}`);
}

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

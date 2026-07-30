/**
 * WhatsApp Cloud API diagnostics.
 *
 * Meta's errors are famously unhelpful ("(#132001) Template name does not
 * exist"), and there are five independent things that must all be right before a
 * message arrives. This script checks them one at a time and says which one is
 * wrong.
 *
 *   node scripts/otp-probe.mjs check                 credentials + sender number
 *   node scripts/otp-probe.mjs templates             list templates and status
 *   node scripts/otp-probe.mjs hello   +974XXXXXXXX  send the pre-approved
 *                                                    hello_world (proves
 *                                                    delivery works at all)
 *   node scripts/otp-probe.mjs otp     +974XXXXXXXX  send the real OTP template
 *   node scripts/otp-probe.mjs create-template         create yourwaves_otp
 *                                                      (ar + en) on the WABA
 *
 * Nothing here is used at runtime — it exists so provisioning can be verified
 * without guessing.
 */
import "./load-env.mjs";

const GRAPH = "https://graph.facebook.com/v21.0";

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME ?? "yourwaves_otp";

const [command, recipient] = process.argv.slice(2);

/** Meta error codes worth translating into something actionable. */
const HINTS = {
  190: "Access token is invalid or expired. The token on the API Setup tab lasts 24 HOURS — generate a System User token for anything permanent.",
  131030:
    'Recipient is not in the allowed list. On a test number you must add each destination under WhatsApp → API Setup → "To", and confirm the code Meta sends it.',
  132001:
    "Template name or language does not exist on this WABA. Check spelling, and that the language code matches the localisation you created (ar vs ar_AR).",
  132000:
    "Parameter count mismatch. The authentication template must have exactly ONE body parameter, and the copy-code button takes the same value.",
  132015: "Template is paused for quality reasons.",
  132007:
    "Template content violates policy — authentication bodies are fixed wording.",
  133010: "Phone number is not registered. Complete registration in API Setup.",
  100: "Malformed request, or you lack permission on this object. If it is a permissions issue the token is missing whatsapp_business_messaging.",
  368: "Temporarily blocked for policy violations.",
  80007: "Rate limit reached on the WhatsApp Business Account.",
  131047:
    "Re-engagement required: you cannot free-form message this user. This is why OTP must go out as an AUTHENTICATION template.",
  131056: "Pair rate limit — too many messages to this recipient too quickly.",
};

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function requireEnv() {
  const missing = [
    !token && "WHATSAPP_ACCESS_TOKEN",
    !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
  ].filter(Boolean);
  if (missing.length) {
    fail(
      `Missing ${missing.join(", ")} in .env.local.\n` +
        "  Both are on developers.facebook.com → your app → WhatsApp → API Setup.\n" +
        "  See docs/whatsapp-setup.md.",
    );
  }
}

async function graph(path, init) {
  const response = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: { message: `non-JSON response (${response.status})` } };
  }
  return { status: response.status, body };
}

function reportError(body) {
  const error = body?.error ?? {};
  console.error(`  message : ${error.message ?? "(none)"}`);
  if (error.code !== undefined) console.error(`  code    : ${error.code}`);
  if (error.error_subcode !== undefined)
    console.error(`  subcode : ${error.error_subcode}`);
  if (error.error_data?.details)
    console.error(`  details : ${error.error_data.details}`);
  if (error.fbtrace_id) console.error(`  fbtrace : ${error.fbtrace_id}`);

  const hint = HINTS[error.code];
  if (hint) console.error(`\n  → ${hint}`);
}

// --- check ---------------------------------------------------------------
async function check() {
  requireEnv();
  console.log("Sender number");
  const { status, body } = await graph(
    `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type,code_verification_status`,
  );
  if (status !== 200) {
    console.error("  ✗ could not read the phone number object");
    reportError(body);
    process.exit(1);
  }
  console.log(`  ✓ id             ${phoneNumberId}`);
  console.log(`  ✓ number         ${body.display_phone_number}`);
  console.log(`  ✓ display name   ${body.verified_name}`);
  console.log(`    quality        ${body.quality_rating ?? "n/a"}`);
  console.log(`    platform       ${body.platform_type ?? "n/a"}`);
  console.log(`    code verified  ${body.code_verification_status ?? "n/a"}`);
  console.log(
    `\n  Token works and the sender is reachable. If sends still fail, the\n` +
      `  recipient is probably not on the test allow-list — run:\n` +
      `    node scripts/otp-probe.mjs hello +974XXXXXXXX`,
  );
}

// --- templates -----------------------------------------------------------
async function templates() {
  requireEnv();
  if (!wabaId) {
    fail(
      "WHATSAPP_BUSINESS_ACCOUNT_ID is not set — needed to list templates.\n" +
        "  It is the WhatsApp Business Account ID shown above the phone number\n" +
        "  in API Setup (a long numeric id, not the app id).",
    );
  }
  const { status, body } = await graph(
    `/${wabaId}/message_templates?fields=name,language,status,category,components&limit=100`,
  );
  if (status !== 200) {
    console.error("  ✗ could not list templates");
    reportError(body);
    process.exit(1);
  }
  const list = body.data ?? [];
  if (list.length === 0) {
    console.log("  (no templates on this WABA yet)");
  }
  for (const template of list) {
    const params =
      template.components
        ?.find((c) => c.type === "BODY")
        ?.text?.match(/\{\{\d+\}\}/g)?.length ?? 0;
    const buttons =
      template.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];
    const flag = template.name === templateName ? "→" : " ";
    console.log(
      `${flag} ${template.name.padEnd(24)} ${String(template.language).padEnd(6)} ` +
        `${String(template.status).padEnd(10)} ${String(template.category).padEnd(15)} ` +
        `body params: ${params}  buttons: ${buttons.map((b) => b.type).join("/") || "none"}`,
    );
  }
  const mine = list.filter((t) => t.name === templateName);
  console.log("");
  if (mine.length === 0) {
    console.log(
      `  ✗ "${templateName}" not found. Create it (Authentication category,\n` +
        `    one body parameter, copy-code button) — see docs/whatsapp-setup.md.`,
    );
  } else {
    for (const t of mine) {
      const ok = t.status === "APPROVED";
      console.log(
        `  ${ok ? "✓" : "✗"} "${templateName}" (${t.language}) is ${t.status}`,
      );
    }
    const langs = mine.map((t) => t.language);
    for (const needed of [
      process.env.WHATSAPP_OTP_TEMPLATE_LANG_AR ?? "ar",
      process.env.WHATSAPP_OTP_TEMPLATE_LANG_EN ?? "en",
    ]) {
      if (!langs.includes(needed)) {
        console.log(
          `  ✗ no "${needed}" localisation — either add it, or point the env var at one of: ${langs.join(", ")}`,
        );
      }
    }
  }
}

// --- create-template -----------------------------------------------------
/**
 * Creates the authentication template in both languages.
 *
 * Note there is no body TEXT here. For the AUTHENTICATION category Meta owns
 * the wording and supplies the approved localisation itself — you opt into the
 * security line and the expiry, and it renders the right sentence in Arabic and
 * English. Supplying custom text is what gets these templates rejected.
 *
 * Templates live on the WABA, so this works on a test setup: no business
 * verification and no billing required.
 */
async function createTemplate() {
  requireEnv();
  if (!wabaId) fail("WHATSAPP_BUSINESS_ACCOUNT_ID is not set.");

  const languages = [
    process.env.WHATSAPP_OTP_TEMPLATE_LANG_EN ?? "en",
    process.env.WHATSAPP_OTP_TEMPLATE_LANG_AR ?? "ar",
  ];

  let failures = 0;
  for (const language of languages) {
    const payload = {
      name: templateName,
      category: "AUTHENTICATION",
      language,
      components: [
        // Adds Meta's "do not share this code" line, localised.
        { type: "BODY", add_security_recommendation: true },
        // Matches CODE_TTL_SECONDS (5 minutes) in src/lib/otp/code.ts.
        { type: "FOOTER", code_expiration_minutes: 5 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
      ],
    };

    const { status, body } = await graph(`/${wabaId}/message_templates`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (status === 200) {
      console.log(
        `  ✓ ${templateName} (${language}) created — status ${body.status ?? "PENDING"}, id ${body.id}`,
      );
    } else if (
      body?.error?.code === 100 &&
      /already exists/i.test(body.error.message ?? "")
    ) {
      console.log(`  = ${templateName} (${language}) already exists`);
    } else {
      failures++;
      console.error(`  ✗ ${templateName} (${language}) failed`);
      reportError(body);
    }
  }

  console.log(
    "\n  Authentication templates usually approve in minutes. Re-check with:\n" +
      "    pnpm otp:probe templates",
  );
  if (failures) process.exit(1);
}

// --- send ----------------------------------------------------------------
async function send(kind) {
  requireEnv();
  if (!recipient)
    fail(
      "Pass a recipient: node scripts/otp-probe.mjs " + kind + " +974XXXXXXXX",
    );

  const to = recipient.replace(/[^\d]/g, "");
  const code = "4821"; // fixed sample; this path never touches the real flow

  const payload =
    kind === "hello"
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          // Pre-approved on every test account, no parameters. If THIS arrives,
          // credentials + sender + allow-list are all correct and any remaining
          // problem is the template itself.
          template: { name: "hello_world", language: { code: "en_US" } },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: templateName,
            language: {
              code: process.env.WHATSAPP_OTP_TEMPLATE_LANG_EN ?? "en",
            },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: code }],
              },
            ],
          },
        };

  console.log(
    `Sending ${kind === "hello" ? "hello_world" : `"${templateName}"`} to +${to}…`,
  );
  const { status, body } = await graph(`/${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (status === 200) {
    console.log(`  ✓ accepted by Meta (message id ${body.messages?.[0]?.id})`);
    console.log(
      "\n  Accepted is not the same as delivered. If nothing arrives within a\n" +
        "  minute: billing not configured, or the recipient is not on the test\n" +
        "  allow-list (that usually errors, but not always).",
    );
    if (kind === "otp") {
      console.log(`\n  The sample code in that message is ${code}.`);
    }
    return;
  }

  console.error(`  ✗ rejected (HTTP ${status})`);
  reportError(body);
  process.exit(1);
}

// --- dispatch ------------------------------------------------------------
switch (command) {
  case "check":
    await check();
    break;
  case "templates":
    await templates();
    break;
  case "hello":
    await send("hello");
    break;
  case "otp":
    await send("otp");
    break;
  case "create-template":
    await createTemplate();
    break;
  default:
    console.log(
      [
        "WhatsApp Cloud API diagnostics",
        "",
        "  node scripts/otp-probe.mjs check                 credentials + sender",
        "  node scripts/otp-probe.mjs templates             list templates",
        "  node scripts/otp-probe.mjs hello +974XXXXXXXX    send pre-approved hello_world",
        "  node scripts/otp-probe.mjs otp   +974XXXXXXXX    send the real OTP template",
        "  node scripts/otp-probe.mjs create-template       create yourwaves_otp (ar+en)",
        "",
        "Run them in that order — each one rules out a layer.",
      ].join("\n"),
    );
}

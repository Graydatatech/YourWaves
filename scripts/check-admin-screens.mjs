/**
 * Drives the WHOLE back office in a real browser, signed in.
 *
 * This is the check that was missing. `check:admin-auth` proves nothing is
 * reachable without a session and `check:admin-layout` measures the two
 * signed-out screens — but the five screens an ops person actually uses were
 * unexercised, and the first two bugs found there were both of a class no unit
 * test can see: a Server/Client component boundary mistake that throws
 * MISSING_MESSAGE at render time.
 *
 * It creates a THROWAWAY admin with a TOTP secret it controls, signs in through
 * the real login and MFA screens, visits every page at phone and desktop
 * widths, and deletes the account afterwards. The real admin's authenticator is
 * never touched.
 *
 * Usage: pnpm check:admin-screens [baseUrl]
 */

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import d from "dotenv";
import postgres from "postgres";
import puppeteer from "puppeteer-core";

d.config({ path: ".env.local", quiet: true });

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EMAIL = `screencheck+${randomBytes(4).toString("hex")}@yourwaves.test`;
const PASSWORD = `Sc-${randomBytes(12).toString("base64url")}`;
const MIN_TARGET = 44;

const failures = [];
function record(ok, label, detail) {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(
    `${ok ? "[32m✓[0m" : "[31m✗[0m"} ${label}${detail ? `  [2m${detail}[0m` : ""}`,
  );
}

/** RFC 4648 base32 → bytes. Authenticator secrets are base32, unpadded. */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP, the six digits an authenticator app would show right now. */
function totp(secret, atSeconds = Math.floor(Date.now() / 1000)) {
  const counter = Math.floor(atSeconds / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let browser = null;
let created = false;

try {
  // --- a throwaway admin -------------------------------------------------
  execFileSync("node", ["scripts/create-admin.mjs", EMAIL, PASSWORD], {
    stdio: "pipe",
  });
  created = true;
  console.log(`\nthrowaway admin: ${EMAIL}\n`);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--hide-scrollbars"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  // Any client-side exception or MISSING_MESSAGE is a failure, wherever it
  // happens — that is the whole class of bug this script exists to catch.
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // --- sign in -----------------------------------------------------------
  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
  ]);

  await page.waitForSelector("#mfa-code", { timeout: 30_000 });
  record(true, "login accepts the password and lands on the MFA gate");

  // The screen shows the secret for manual entry; that is what an authenticator
  // app would have stored from the QR code.
  const secret = await page.evaluate(() => {
    const code = document.querySelector("code");
    return code ? code.textContent.trim() : null;
  });
  record(
    Boolean(secret),
    "MFA enrolment offers a TOTP secret",
    secret ? "present" : "missing",
  );
  if (!secret) throw new Error("no TOTP secret rendered");

  await page.type("#mfa-code", totp(secret));
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }),
  ]);

  const landed = new URL(page.url()).pathname;
  record(
    landed === "/admin",
    "verifying the code lands on the dashboard",
    landed,
  );

  // --- every screen, at both widths --------------------------------------
  const reference = (
    await sql`SELECT reference FROM bookings ORDER BY created_at DESC LIMIT 1`
  )[0]?.reference;

  const SCREENS = [
    ["/admin", "Overview"],
    ["/admin/calendar", "Calendar"],
    ["/admin/orders", "Orders"],
    ["/admin/settings", "Settings"],
    ...(reference ? [[`/admin/bookings/${reference}`, "Booking detail"]] : []),
  ];

  for (const [path, name] of SCREENS) {
    for (const width of [390, 1280]) {
      consoleErrors.length = 0;
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
      const response = await page.goto(`${BASE}${path}`, {
        waitUntil: "networkidle0",
        timeout: 60_000,
      });

      const result = await page.evaluate((min) => {
        const doc = document.documentElement;
        let culprit = null;
        const overflow = doc.scrollWidth - doc.clientWidth;
        if (overflow > 1) {
          for (const el of document.querySelectorAll("*")) {
            if (el.getBoundingClientRect().width > doc.clientWidth + 1) {
              culprit = `${el.tagName.toLowerCase()}.${
                typeof el.className === "string"
                  ? el.className.split(/\s+/).slice(0, 3).join(".")
                  : ""
              }`;
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
              `${el.tagName.toLowerCase()}"${(el.textContent || "").trim().slice(0, 16)}" ${Math.round(rect.height)}px`,
            );
          }
        }

        return {
          overflow,
          culprit,
          small,
          text: document.body.innerText,
          /**
           * `<nextjs-portal>` is present on every page in development — it
           * hosts the dev tools indicator, not just errors — so its mere
           * existence proves nothing. Only the error text does. The pageerror
           * and console listeners above are the real net.
           */
          hasErrorOverlay:
            /Unhandled Runtime Error|Runtime Error|MISSING_MESSAGE/i.test(
              document.body.innerText,
            ),
        };
      }, MIN_TARGET);

      const tag = `${name} @${width}px`;

      record(
        response.status() === 200,
        `${tag}: renders`,
        `${response.status()}`,
      );
      record(
        !result.hasErrorOverlay,
        `${tag}: no runtime error`,
        result.hasErrorOverlay ? "error overlay present" : "",
      );
      record(
        consoleErrors.length === 0,
        `${tag}: no console errors`,
        consoleErrors.slice(0, 2).join(" | ").slice(0, 160),
      );
      record(
        !/MISSING_MESSAGE/.test(result.text),
        `${tag}: no missing translations`,
      );
      record(
        result.overflow <= 1,
        `${tag}: no horizontal overflow`,
        result.overflow > 1 ? `${result.overflow}px via ${result.culprit}` : "",
      );
      if (width === 390) {
        record(
          result.small.length === 0,
          `${tag}: every control clears ${MIN_TARGET}px`,
          result.small.slice(0, 3).join("; "),
        );
      }
      record(
        result.text.includes(name === "Booking detail" ? "YW-" : name),
        `${tag}: renders its own heading`,
        `${result.text.length} chars`,
      );
    }
  }
} catch (error) {
  record(
    false,
    "run completed without throwing",
    String(error?.message ?? error),
  );
} finally {
  if (browser) await browser.close();
  if (created) {
    // Remove the throwaway entirely: auth.users cascades to identities,
    // factors and sessions; user_roles has its own FK-free row.
    await sql`DELETE FROM user_roles WHERE email = ${EMAIL}`;
    await sql`DELETE FROM auth.users WHERE email = ${EMAIL}`;
    console.log(`\nremoved throwaway admin`);
  }
  await sql.end();
}

console.log(
  failures.length
    ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}`
    : "\nall checks passed",
);
process.exit(failures.length ? 1 : 0);

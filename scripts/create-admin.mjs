/**
 * Creates the first back-office admin.
 *
 * Writes straight to `auth.users` over DATABASE_URL rather than calling the
 * signup API, for two reasons:
 *
 *   1. The project has `mailer_autoconfirm: false`, so a signup would send a
 *      real confirmation email to a real inbox and the account would be
 *      unusable until someone clicked it. Setting `email_confirmed_at` here is
 *      exactly what the dashboard's "Auto Confirm User" checkbox does.
 *   2. Creating a confirmed user through the API needs the service_role key,
 *      which this project deliberately does not have and does not want.
 *
 * `identity_data` is built with jsonb_build_object IN SQL, not with
 * JSON.stringify. postgres.js serialises a parameter itself when it sees a
 * ::jsonb cast, so a pre-stringified object is encoded TWICE and stored as a
 * jsonb string. auth.identities.email is GENERATED from
 * identity_data->>'email', so it silently computes to NULL — and GoTrue then
 * fails every sign-in with "Database error querying schema", long after the row
 * looked perfectly fine in the dashboard.
 *
 * THE EMPTY-STRING TOKEN COLUMNS ARE NOT DECORATION. GoTrue scans
 * confirmation_token, recovery_token, email_change and email_change_token_new
 * into Go strings, and a NULL there fails with "converting NULL to string is
 * unsupported" at SIGN-IN time — long after the row looked fine. A user created
 * without them appears correct in the dashboard and simply cannot log in.
 *
 * Usage: node scripts/create-admin.mjs <email> [password]
 *        (a strong password is generated when none is given)
 */

import { randomBytes } from "node:crypto";
import d from "dotenv";
import postgres from "postgres";

d.config({ path: ".env.local", quiet: true });

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/create-admin.mjs <email> [password]");
  process.exit(1);
}

/** 24 chars from a URL-safe alphabet: strong, and typable if it has to be. */
function generatePassword() {
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_";
  return [...randomBytes(24)]
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
}

const password = process.argv[3] ?? generatePassword();
const generated = process.argv[3] === undefined;

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

try {
  const existing = await sql`
    SELECT id FROM auth.users WHERE lower(email) = ${email}
  `;

  let userId;

  if (existing[0]) {
    userId = existing[0].id;
    console.log(`user already exists: ${email} (${userId})`);
    // Reset the password so an interrupted first run is recoverable.
    await sql`
      UPDATE auth.users
         SET encrypted_password = crypt(${password}, gen_salt('bf')),
             email_confirmed_at = COALESCE(email_confirmed_at, now()),
             updated_at = now()
       WHERE id = ${userId}::uuid
    `;
    console.log("password reset");
  } else {
    const rows = await sql`
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token,
        email_change, email_change_token_new
      ) VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid,
        gen_random_uuid(),
        'authenticated', 'authenticated',
        ${email},
        crypt(${password}, gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(), now(),
        '', '', '', ''
      )
      RETURNING id
    `;
    userId = rows[0].id;
    console.log(`created auth user: ${email} (${userId})`);
  }

  // Identity row. GoTrue expects one per provider; without it some flows
  // (password reset, provider linking) behave oddly.
  await sql`
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) VALUES (
      ${userId}::text, ${userId}::uuid,
      jsonb_build_object('sub', ${userId}::text, 'email', ${email}::text),
      'email', now(), now(), now()
    )
    ON CONFLICT (provider, provider_id) DO NOTHING
  `;

  // The authorisation half. Identity proves who they are; this grants access.
  await sql`
    INSERT INTO user_roles (user_id, role, email)
    VALUES (${userId}::uuid, 'admin', ${email})
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin', updated_at = now()
  `;

  console.log("granted role: admin");
  console.log("\n  email:    " + email);
  if (generated) {
    console.log("  password: " + password);
    console.log("\n  ^ shown once. Change it after signing in.");
  }
  console.log(
    "\nNext: http://localhost:3000/admin/login — you will be asked to set up\n" +
      "a TOTP authenticator immediately, because MFA is mandatory for admins.",
  );
} catch (error) {
  console.error("failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

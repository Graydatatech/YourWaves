/**
 * Removes every unverified TOTP factor for a user, so the MFA screen can enrol
 * from scratch.
 *
 * An abandoned enrolment cannot be resumed — the QR code and secret are only
 * returned when the factor is created — so a half-finished factor is pure
 * obstruction: it occupies its friendly name and blocks the next attempt with
 * `mfa_factor_name_conflict`.
 *
 * VERIFIED factors are left alone unless --all is passed. Deleting someone's
 * working authenticator without being asked is how you lock an admin out.
 *
 * Usage: node scripts/reset-mfa.mjs <email> [--all]
 */
import d from "dotenv";
import postgres from "postgres";
d.config({ path: ".env.local", quiet: true });

const email = (process.argv[2] ?? "").trim().toLowerCase();
const includeVerified = process.argv.includes("--all");
if (!email) {
  console.error("Usage: node scripts/reset-mfa.mjs <email> [--all]");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
try {
  const [user] =
    await sql`SELECT id FROM auth.users WHERE lower(email) = ${email}`;
  if (!user) {
    console.error(`no such user: ${email}`);
    process.exit(1);
  }

  const factors = await sql`
    SELECT id, friendly_name, status FROM auth.mfa_factors
     WHERE user_id = ${user.id}::uuid ORDER BY created_at`;
  console.log(`factors for ${email}: ${factors.length}`);
  for (const f of factors) {
    console.log(`  ${f.status.padEnd(11)} ${f.friendly_name ?? "(unnamed)"}`);
  }

  const removed = await sql`
    DELETE FROM auth.mfa_factors
     WHERE user_id = ${user.id}::uuid
       AND (${includeVerified} OR status <> 'verified')
    RETURNING id`;
  console.log(
    `\nremoved ${removed.length}${includeVerified ? " (including verified)" : " unverified"}`,
  );
} finally {
  await sql.end();
}

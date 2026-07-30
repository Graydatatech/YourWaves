import "server-only";

import { sql } from "@/db/client";
import { createSupabaseServerClient, supabaseAuthConfigured } from "./supabase";

/**
 * Who is asking, and what they are allowed to see.
 *
 * Two independent facts are needed and they come from different places:
 *
 *   1. IDENTITY — proved by a Supabase session cookie. Signed by Supabase, so
 *      the browser cannot forge it.
 *   2. AUTHORISATION — read from `user_roles` on every request. Deliberately
 *      not a JWT claim: a claim is only refreshed when a token is reissued, so
 *      removing someone's access would leave them an admin for up to an hour.
 *
 * MFA is the third fact. Supabase expresses it as an assurance level: `aal1` is
 * "password accepted", `aal2` is "and a second factor was verified". An admin
 * session that is merely aal1 is treated as NOT signed in.
 */

/**
 * There is exactly one back-office role.
 *
 * Phase 9 removed the driver login entirely — drivers never sign in; they get a
 * WhatsApp link with a capability token (see §4i). `user_roles` is admin-only
 * now, enforced by a CHECK constraint in migration 0010.
 */
export type AdminRole = "admin";

export type AdminSession = {
  userId: string;
  email: string | null;
  role: AdminRole;
  /** A human name for audit rows. */
  displayName: string;
};

export type SessionRefusal =
  /** No Supabase project configured — the whole back office is unavailable. */
  | "not_configured"
  /** No session cookie, or it has expired. */
  | "signed_out"
  /** Signed in, but no second factor has been enrolled yet. */
  | "mfa_required_enrol"
  /** Enrolled, but this session has not passed the second factor. */
  | "mfa_required_challenge"
  /** A real Supabase user with no row in user_roles. Logged in ≠ authorised. */
  | "no_role";

export type SessionResult =
  { ok: true; session: AdminSession } | { ok: false; reason: SessionRefusal };

/**
 * Resolves the current session, including the MFA gate.
 *
 * `getUser()` rather than `getSession()`: getSession reads the cookie and
 * trusts it, while getUser revalidates against the Auth server. On a page that
 * decides authorisation, the extra round trip is the point.
 */
export async function getAdminSession(): Promise<SessionResult> {
  if (!supabaseAuthConfigured()) {
    return { ok: false, reason: "not_configured" };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, reason: "signed_out" };

  // --- the MFA gate -------------------------------------------------------
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal) {
    // nextLevel is aal2 exactly when the user has a verified factor. So
    // "nextLevel is aal1" means no factor exists yet, and an admin must enrol
    // before they can do anything.
    if (aal.nextLevel === "aal1") {
      return { ok: false, reason: "mfa_required_enrol" };
    }
    if (aal.currentLevel !== "aal2") {
      return { ok: false, reason: "mfa_required_challenge" };
    }
  }

  // --- authorisation ------------------------------------------------------
  const rows = await sql<{ role: AdminRole; email: string | null }[]>`
    SELECT role, email FROM user_roles WHERE user_id = ${user.id}::uuid
  `;

  const row = rows[0];
  if (!row) return { ok: false, reason: "no_role" };

  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email ?? row.email,
      role: row.role,
      displayName:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email ??
        row.email ??
        "Admin",
    },
  };
}

/**
 * Kept as a distinct entry point even though 'admin' is now the only role:
 * every call site reads `requireAdmin`/`getAdminOnlySession` and means "an
 * administrator", and a future second role should have to be let in explicitly
 * rather than inherited by everything.
 */
export async function getAdminOnlySession(): Promise<SessionResult> {
  const result = await getAdminSession();
  if (result.ok && result.session.role !== "admin") {
    return { ok: false, reason: "no_role" };
  }
  return result;
}

const REFUSAL_STATUS: Record<SessionRefusal, number> = {
  not_configured: 503,
  signed_out: 401,
  mfa_required_enrol: 403,
  mfa_required_challenge: 403,
  no_role: 403,
};

/**
 * The guard every admin API route starts with.
 *
 * Returns a Response when the caller is refused, or the session when they are
 * allowed — so a route reads:
 *
 *     const auth = await requireAdmin();
 *     if (auth instanceof Response) return auth;
 *
 * This replaces the ADMIN_API_SECRET placeholder from phase 7 entirely.
 */
export async function requireAdmin(): Promise<AdminSession | Response> {
  const result = await getAdminOnlySession();
  if (result.ok) return result.session;

  return Response.json(
    { error: result.reason },
    {
      status: REFUSAL_STATUS[result.reason],
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/**
 * Runs a query with the caller's own identity, so RLS applies to it.
 *
 * The application connects as the table owner, which — since migration 0003
 * removed FORCE — is NOT subject to row level security. That is right for the
 * customer-facing routes, which act for an anonymous person and must reach
 * every row. It is wrong for the back office, where "may this person see this
 * row?" is the entire question.
 *
 * So back-office reads switch to the `authenticated` role and set the same JWT
 * claims GUC PostgREST would, for the duration of one transaction. The policies
 * in 0008 then govern the query. This is what makes them load-bearing rather
 * than decorative: a bug in a route handler's WHERE clause cannot leak another
 * driver's booking, because the database refuses to return it.
 *
 * Admins see everything either way. The value is that a bug in a route's WHERE
 * clause still cannot reach past what the policies allow — the enforcement does
 * not depend on the query being right.
 */
export async function asUser<T>(
  userId: string,
  run: (tx: typeof sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`
      SELECT set_config('request.jwt.claims',
        json_build_object('sub', ${userId}::text)::text, true)
    `;
    return run(tx as unknown as typeof sql);
  }) as Promise<T>;
}

import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { getAdminUsers } from "@/lib/admin/queries";
import { createAdminUser } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
});

/** GET /api/admin/admins — who has back-office access. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  return Response.json(
    { ok: true, admins: await getAdminUsers(auth) },
    { headers: NO_STORE },
  );
}

/**
 * POST /api/admin/admins — create an account and grant it the admin role.
 *
 * ANY ADMIN CAN CREATE ANOTHER ADMIN. That is a flat model, chosen because the
 * alternative — a super-admin tier — adds a role hierarchy to a team of two or
 * three people and creates a new way to be locked out. It does mean admin
 * access is transitive, so the list on the settings screen is the control:
 * everyone can see who else has access.
 *
 * The generated password is in the RESPONSE BODY and nowhere else. It is not
 * logged, not stored in readable form, and cannot be retrieved again — the
 * `auth.users` row holds a bcrypt hash. If the person who created the account
 * loses it, the remedy is to create it again, which resets the password.
 *
 * `no-store` matters more than usual here for that reason.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "invalid_email" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await createAdminUser(auth, parsed.data.email);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.code },
      { status: result.code === "already_admin" ? 409 : 422, headers: NO_STORE },
    );
  }

  console.info("[admin] admin account created", {
    by: auth.userId,
    // The new admin's address, deliberately — this is an audit line and the
    // email is not the secret. The password is not here and must not be.
    email: result.email,
  });

  return Response.json(
    {
      ok: true,
      userId: result.userId,
      email: result.email,
      password: result.password,
    },
    { status: 201, headers: NO_STORE },
  );
}

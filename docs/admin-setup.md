# Back office — setup and operations

Supabase Auth **is configured** on this project and the whole flow is verified.
This document covers what a fresh environment needs and how to run it.

Without the two environment variables below the back office is CLOSED, not open:
every admin page redirects to `/admin/login`, which explains what is missing,
and every admin API answers `503 not_configured`. With no way to authenticate
anyone, refusing is the only safe default.

## 1. Environment

From **Supabase → Project Settings → API Keys**:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
# The "anon / public" key. Newer projects issue `sb_publishable_...`; older ones
# a `eyJ...` JWT. @supabase/ssr accepts either.
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

The project ref is already in your `DATABASE_URL` — it is the part after
`postgres.` in the username.

The anon key is safe in the browser: RLS is deny-all for `anon`, so it can reach
nothing. `SUPABASE_SERVICE_ROLE_KEY` is **not** needed — the application talks
to Postgres directly through `DATABASE_URL`, and Supabase's SDK is used only for
authentication.

## 2. Turn on MFA

**Supabase → Authentication → Providers → Email**: leave email/password on and
turn **"Confirm email"** on.

**Authentication → Multi-Factor**: enable **TOTP (App Authenticator)**.

MFA is mandatory for admins and enforced server-side — `getAdminSession()`
treats a password-only (`aal1`) session as signed out, so skipping the enrolment
screen simply bounces back to it.

Consider disabling public sign-ups (**Authentication → Sign In / Providers →
"Allow new users to sign up"**). A stranger who signs up gets no role and can
see nothing, but there is no reason to let them create the account.

## 3. Create the first admin

Auth users and roles are separate on purpose: a Supabase account proves
**identity**, `user_roles` grants **authorisation**. Being logged in is not the
same as being allowed in.

```bash
node scripts/create-admin.mjs ops@yourwaves.qa
```

It creates the auth user, its identity row and the `user_roles` grant, then
prints a generated password once. Then visit `/admin/login`, sign in, and scan
the QR code with any authenticator app.

**Why a script rather than the dashboard:** this project has
`mailer_autoconfirm` OFF, so creating a user through the signup API emails a
confirmation link and the account is unusable until someone clicks it. The
script sets `email_confirmed_at` directly, which is exactly what the dashboard's
"Auto Confirm User" checkbox does — and it gets right two things that are easy
to get wrong by hand, both documented at the top of the file: the empty-string
token columns GoTrue requires, and building `identity_data` in SQL so the
generated `auth.identities.email` column is populated. Either mistake produces
`Database error querying schema` at sign-in, long after the row looks fine.

There is deliberately no self-service "invite an admin" flow — the roles table
is small, rarely changed, and a bug in an invitation flow grants strangers a
dashboard.

### Adding a driver login (phase 9)

```sql
insert into user_roles (user_id, role, driver_id, email)
values ('<auth-user-uuid>', 'driver', '<drivers.id>', 'driver@example.com');
```

A driver login sees only bookings assigned to that `driver_id`, and cannot read
payments, notifications, notes or settings at all. That is enforced by RLS, not
by the UI — `tests/admin-rls.test.ts` proves it, including that a direct lookup
of a known booking id from another driver returns nothing.

## 4. Removing access

```sql
delete from user_roles where user_id = '<uuid>';
```

Effective on the next request. The role is read from the table on every request
rather than baked into the JWT, precisely so revocation is immediate — a claim
would leave someone an admin until their token expired.

## How authorisation works

Three layers, each covering what the others cannot:

| Layer | Sees | Catches |
| --- | --- | --- |
| `src/proxy.ts` | the session cookie only | an anonymous request, before any route runs |
| `(dashboard)/layout.tsx` | cookie + database | no MFA, or no role |
| `requireAdmin()` in every API route | cookie + database | a fetch, which no layout runs for |

Reads then go through `asUser()`, which switches the connection to the
`authenticated` role and sets the same JWT claims GUC PostgREST would, so the
RLS policies from migration 0008 govern the query itself. A missing `WHERE`
clause in a route cannot leak another driver's booking, because the database
refuses to return it.

Writes go through the SQL functions (`transition_booking_status`,
`assign_driver`, `add_blackout_date`), which hold invariants the back office
must not be able to skip. Each one is preceded by a read of the booking under
RLS — if the caller cannot see it, they cannot write it.

## Verifying

```bash
pnpm check:admin-auth     # 22 checks: nothing is reachable unauthenticated
pnpm check:admin-layout   # bottom tabs, 44px targets, the 900px swap
pnpm check:admin-screens  # SIGNS IN and drives all five screens
pnpm test                 # includes admin-rls (20) and admin-transitions (14)
```

`check:admin-auth` is worth running against a deployment too. It follows no
redirects on purpose: `fetch` follows them by default, which turns a
redirect-to-login into a `200` carrying the login page — indistinguishable from
success to anything checking `response.ok`. That is a real bug it caught here.

## Verified end to end

Auth is configured and the whole flow works: password sign-in, TOTP enrolment,
the MFA challenge, and all five screens.

`pnpm check:admin-screens` reproduces it headlessly — it creates a throwaway
admin, computes real TOTP codes, signs in through the actual login and MFA
screens, drives every page at 390px and 1280px, and deletes the account. It
never touches a real admin's authenticator.

### Operational scripts

```bash
node scripts/create-admin.mjs <email>   # create an admin (prints a password)
node scripts/reset-mfa.mjs <email>      # clear an abandoned TOTP enrolment
node scripts/reset-mfa.mjs <email> --all  # also remove a WORKING authenticator
```

`reset-mfa` needs `--all` to touch a verified factor, because deleting an
admin's live authenticator unasked is how you lock someone out of the dashboard.

An abandoned enrolment is worth clearing: the QR code and secret are only
returned when a factor is created, so a half-finished one cannot be resumed —
it just occupies its name.

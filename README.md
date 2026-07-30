# YourWaves

**A bilingual (Arabic/English) booking platform for renting a mobile Flowrider —
a full-scale artificial standing wave — delivered to a private villa in Qatar
for a full day.**

A customer picks a date, tells us where to set up and pays. The office runs the
day from a back-office dashboard, and the crew gets a WhatsApp message with a
link to the job.

---

## What it does

| | |
| --- | --- |
| **Booking** | One booking per day. Calendar, time slot, contact details, location, live pricing. |
| **Payments** | The date is held for 10 minutes during checkout. A booking is confirmed by the payment webhook — never by a browser redirect. |
| **Notifications** | WhatsApp and email, drained from an outbox by a worker with retries and backoff. Nothing is sent from inside a request. |
| **Back office** | Overview, calendar, orders, booking detail and settings. Supabase Auth with mandatory TOTP. |
| **Dispatch** | No driver portal. Each recipient gets their own expiring link to a mobile job sheet they act on. |

Arabic is the **default** locale and the layout mirrors automatically — a custom
ESLint rule fails the build on physical-direction classes (`ml-*`, `text-left`,
…), so RTL cannot quietly rot.

---

## Stack

- **Next.js 16.2** (App Router, Turbopack) · React 19 · TypeScript `strict`
- **Tailwind CSS v4** — design tokens in `src/app/globals.css`, no config file
- **next-intl 4** — `[locale]` segment, `ar` (RTL, default) and `en`
- **Postgres** (Supabase in production) — Drizzle schema, hand-written locking SQL
- **Vitest** against a real Postgres — 263 tests
- **pnpm** (never `npm install`)

> **Next.js 16 differs from Next 15 and from most training data.**
> `middleware.ts` is now `proxy.ts`, `params` / `searchParams` / `cookies()` /
> `headers()` are Promises, and `next lint` is gone. See `CLAUDE.md` §2.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local     # then fill in the values below
pnpm db:check                  # connection, pooler, RLS, migrations, seed
pnpm db:migrate && pnpm db:seed
pnpm dev                       # http://localhost:3000
```

`/` redirects to `/ar`. The back office is at `/admin`; create the first
administrator with:

```bash
node scripts/create-admin.mjs you@example.com
```

MFA is mandatory, so the first sign-in walks through TOTP enrolment. See
[docs/admin-setup.md](docs/admin-setup.md).

### Connecting to Supabase

Use the **session pooler** string on port **5432**. Not the transaction pooler
(6543) — advisory locks do not survive there, and the booking lock depends on
them. Not the direct `db.<ref>.supabase.co` host either; it is IPv6-only and
unreachable from most networks and CI.

Keep `TEST_DATABASE_URL` pointed at a **local** database. The suite truncates
tables on every run and refuses any URL whose name does not end in `_test`.

---

## Environment

Every variable is documented in [.env.example](.env.example). The ones a working
install needs:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Session pooler, port 5432 |
| `TEST_DATABASE_URL` | Local database, name ending `_test` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Back-office auth |
| `OTP_TOKEN_SECRET` | 32+ characters; rotating it invalidates in-flight verifications |
| `CRON_SECRET` | Guards the cron endpoints; they refuse to run without it |
| `PAYMENT_PROVIDER` | `skipcash` or `mock` — **`mock` throws in production** |
| `OTP_CHANNEL` | `whatsapp` or `console` — **`console` throws in production** |

The development fallbacks all refuse to start in a production build, on purpose.
A deployment that quietly logged one-time codes to stdout, or confirmed bookings
while taking no money, would look like it was working — so it fails loudly
instead.

---

## Commands

```bash
pnpm dev / build / start
pnpm verify                # lint + typecheck (what pre-commit runs)
pnpm test                  # vitest against TEST_DATABASE_URL
pnpm format                # prettier

# Database
pnpm db:check              # RUN THIS FIRST — names the fix for each failure mode
pnpm db:migrate            # apply pending migrations
pnpm db:setup              # reset + seed (local only)

# Verification — all against real HTTP and a real database, no mocks
pnpm check:layout          # overflow, nav rows, tap targets, type scale
pnpm check:booking         # calendar cell floor, RTL mirroring, locale-switch state
pnpm check:admin-auth      # nothing reachable without a session
pnpm check:admin-screens   # signs in with real TOTP and drives all five screens
pnpm payments:e2e          # hold → checkout → signed webhook → confirmed
pnpm notifications:e2e     # paid booking → worker → sent → resend
pnpm dispatch:e2e          # payment → WhatsApp link → job actions → revoke
pnpm test:holds-soak       # 50-parallel hold race, N times
```

The `*:e2e` scripts need a **dev** server: their fixtures go through the mock
provider and console transports, which a production build refuses. Browser
checks want the opposite — `pnpm build && pnpm start`.

---

## Layout

```
src/
├── app/[locale]/      the public site — marketing + booking
├── app/admin/         the back office (English-only), gated by proxy + layout + route guards
├── app/d/[token]/     the dispatch job sheet — public, no login, scoped to one booking
├── app/api/           route handlers: availability, bookings, payments, otp, cron, admin
├── components/        ui/ primitives, marketing/ sections, booking/ flow
├── lib/               dates, availability, booking, otp, payments, notifications, admin, dispatch
└── db/                Drizzle schema, server-only client, the queries a customer can reach
drizzle/               migrations — the locking, RLS and settlement logic lives here
docs/                  setup guides for Supabase, SkipCash, WhatsApp and email
scripts/               db tooling, e2e runs and the browser checks above
```

**`CLAUDE.md` is the real engineering document.** It records *why* things are as
they are — the no-double-booking guarantee, the three layers of the checkout
lock, why only the webhook confirms a booking, the bidi rules, and the traps each
phase actually hit. Read it before changing anything load-bearing.

---

## How the dates and the money are protected

- **No double booking** is enforced by a partial unique index in Postgres, not by
  application code. Cancelled and expired rows are excluded, so releasing a date
  frees it immediately while the history survives.
- **Checkout holds** take a per-date advisory lock, re-check availability inside
  it, and keep that unique index as a backstop — one SQL function, one
  transaction, one round trip.
- **Only the payment webhook confirms a booking.** A return URL is trivially
  forgeable, so the success page polls the server instead, and even the recovery
  path settles through the same SQL the webhook uses.
- **Money is integers in minor units.** Amounts are recomputed server-side from
  the booking row; a client that posts its own total is ignored.
- **Rate limits live in SQL**, not Node, because each is a read-then-write that
  two concurrent requests would otherwise slip straight past.

---

## Status

Phases 0–9 are complete: design system, marketing site, data layer, booking
flow, phone verification, checkout holds, payments, notifications, back office
and dispatch. Remaining: content and SEO, a performance and accessibility audit,
and launch hardening.

**Not verified, and not verifiable from this repository** — each needs an account
the client must provision:

- **SkipCash** has no merchant account, so the request-signature field order and
  the webhook body names are marked `ADJUST-ON-SANDBOX` in the code. What
  protects the money *is* exercised, because the mock provider signs its webhooks
  for real rather than trusting whatever arrives.
- **WhatsApp Cloud API** — no Meta business account, so no OTP or dispatch
  message has actually been delivered. Templates for submission are generated
  into [docs/whatsapp-templates.md](docs/whatsapp-templates.md).
- **Email** — no Resend domain. The templates render and are asserted against the
  constraints Outlook and Gmail impose, but have not been opened in a real
  client.

Supabase Auth, by contrast, **is** configured and verified end to end.

---

## Conventions

- Conventional Commits — `feat(booking): …`, `fix(rtl): …`
- Branch off `main`; `pre-commit` runs `pnpm lint && pnpm typecheck`
- Logical CSS properties only (`ms-*`, `text-start`); the lint rule enforces it
- Every date is an `IsoDate` string in Asia/Qatar, and `src/lib/dates.ts` is the
  only place one is parsed or formatted

---

## Licence

Private and proprietary. All rights reserved.

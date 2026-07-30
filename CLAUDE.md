@AGENTS.md

# YourWaves

**Bilingual (AR/EN) booking platform for renting a mobile Flowrider — an
artificial standing-wave generator — to private villas for a full day.**

Reference: SRS GDT-SRS-2026-YW-01. Built in ~12 phases. **Read this file first
in every session.**

---

## 1. The mobile-first rule

The overwhelming majority of users book on a **mobile browser** (iOS Safari,
Android Chrome), most on **4G**. Mobile is the primary design target, not an
adaptation.

- **Every layout starts at 390px and scales up.** Write the base styles for
  mobile; add `sm:` / `md:` / `lg:` only to *widen*. Never write a desktop
  layout and then claw it back with breakpoints.
- **Desktop is the afterthought.** If a decision trades mobile quality for
  desktop polish, mobile wins.
- **Minimum 44x44px interactive target**, always. Use the `tap-target` utility.
- **Inputs never render below 16px** — iOS Safari force-zooms the viewport when
  a focused input is smaller, which throws the user out of the form.
- Budget for 4G: prefer Server Components, avoid client JS for anything the
  platform gives you free (`<details>` for accordions, `<dialog>` for sheets,
  native `<select>` for pickers).

---

## 2. Stack

| Concern       | Choice                          | Notes                                                        |
| ------------- | ------------------------------- | ------------------------------------------------------------ |
| Framework     | **Next.js 16.2.11** App Router  | ⚠️ Not 15 — see "Next.js 16 gotchas" below                   |
| React         | 19.2.4                          | Server Components by default; `"use client"` only when needed |
| Language      | TypeScript, `strict: true`      | `pnpm typecheck` must stay clean                             |
| Styling       | Tailwind CSS v4                 | Tokens via `@theme` in `src/app/globals.css`; no config file |
| i18n          | next-intl 4.13                  | `[locale]` segment; `ar` default (RTL), `en` (LTR)           |
| Fonts         | `next/font/google`, self-hosted | Sora, Manrope, IBM Plex Sans Arabic                          |
| Database      | Postgres (Supabase in prod)     | Drizzle schema + migrations; locking logic is hand-written SQL |
| Tests         | Vitest against a real Postgres  | `pnpm test`; needs `TEST_DATABASE_URL`                       |
| Package mgr   | **pnpm**                        | Never `npm install`                                          |
| Lint / format | ESLint 9 flat config + Prettier | Includes the custom RTL rule                                 |
| Git hooks     | Husky                           | `pre-commit` → `pnpm lint && pnpm typecheck`                 |

### Next.js 16 gotchas (differs from Next 15 and from most training data)

- **`middleware.ts` is renamed to `proxy.ts`**, and the export is `proxy`, not
  `middleware`. Ours lives at [src/proxy.ts](src/proxy.ts). The runtime is
  Node.js and cannot be set to `edge`.
- **Async request APIs are mandatory.** `params`, `searchParams`, `cookies()`,
  `headers()` and `draftMode()` are Promises — synchronous access was removed
  entirely in 16. Always `await params`.
- **Turbopack is the default** for `next dev` *and* `next build`. A custom
  webpack config would fail the build.
- **`next lint` was removed.** Lint via the ESLint CLI (`pnpm lint`).
- **Scroll behaviour**: Next no longer overrides `scroll-behavior` during
  navigation unless `data-scroll-behavior="smooth"` is on `<html>`. Ours sets it.
- Before writing code against a Next.js API, **read the local docs** in
  `node_modules/next/dist/docs/` — this version differs from training data.

### Performance rules learned the hard way (phase 1)

- **`next/font` must use `preload: false` here.** It defaults to `true` and
  emits a preload link for *every* declared face on *every* route, so an
  English page was preloading the Arabic family: 244KB of fonts against an 11KB
  hero image, pushing LCP to 4.4s. With preloading off, a face is fetched only
  when the cascade resolves an element to it, and `display: "swap"` means text
  still paints immediately. Do not "helpfully" turn preload back on.
- **`NextIntlClientProvider` ships the entire catalogue to the browser** unless
  given an explicit `messages` prop. `src/app/[locale]/layout.tsx` narrows it to
  `CLIENT_NAMESPACES`. Add a namespace there when a *Client* Component needs it
  — a Server Component does not. **If a label renders as its raw key
  (`booking.steps.dateTitle`), this is why.** It bit phase 3: the whole booking
  flow is client-side and every string rendered as a key until `booking` was
  added to the list.
- **Never use `background-attachment: fixed`** on a full-page gradient, and
  avoid large CSS `blur()` on animated elements. Both are heavy repaints on a
  throttled mobile CPU; bake softness into gradient colour stops instead.
- Only the hero poster is `priority`. Everything else is lazy.

### Commands

```bash
pnpm dev           # dev server
pnpm build         # production build
pnpm lint          # ESLint, incl. the RTL rule
pnpm typecheck     # tsc --noEmit
pnpm verify        # lint + typecheck (what pre-commit runs)
pnpm format        # Prettier write

# Verification against a running production build (pnpm build && pnpm start):
pnpm check:layout      # real browser: overflow, nav rows, tap targets, type scale
pnpm check:booking     # calendar cell floor, RTL mirroring, locale-switch state
pnpm check:lighthouse  # Lighthouse mobile; THROTTLING=devtools for applied throttling
pnpm check:success     # success/failed pages, 320-414px, both locales
pnpm gen:placeholders  # regenerate public/media/* placeholder imagery

# Payments (need a dev server: mock is refused in a production build, by design)
pnpm payments:e2e      # hold → checkout → signed webhook → confirmed → date gone
pnpm payments:recovery # lost webhook recovered by ?fallback=1 and by the cron job
pnpm payments:probe    # prints the exact SkipCash signing string
node scripts/e2e-cleanup.mjs   # cancel fixtures left by an interrupted run

# Notifications (need a dev server: console transports are refused in production)
pnpm notifications:e2e      # paid booking → worker → sent → driver → resend
pnpm gen:whatsapp-templates # regenerate docs/whatsapp-templates.md from the contract
#   /dev/emails             # every template, both locales, from sample data

# Back office (phase 8) — needs a dev server
pnpm check:admin-auth       # nothing reachable without a session (22 checks)
pnpm check:admin-layout     # bottom tabs, 44px targets, the 900px swap
pnpm check:admin-screens    # SIGNS IN (throwaway admin + real TOTP) and drives
                            #   all five screens at 390/1280px
node scripts/create-admin.mjs <email>      # first admin; see docs/admin-setup.md
node scripts/reset-mfa.mjs <email>         # clear an abandoned TOTP enrolment
#   /dev/admin-nav          # the real nav components, outside the auth gate

# Dispatch (phase 9) — needs a DEV server: the fixture is created through the
# real payment flow, and the mock provider is refused in a production build.
pnpm dispatch:e2e           # payment → WhatsApp per recipient → open the link →
                            #   act → photo → revoke → dead (27 checks)
# Looking at the job sheet in a browser needs the opposite — build && start —
# because the dev server's HMR socket leaves the page unhydrated in headless.

# Database
pnpm db:check      # verify a connection: pooler, RLS, migrations, seed. RUN THIS FIRST
pnpm db:generate   # drizzle-kit: regenerate migrations after editing schema.ts
pnpm db:migrate    # apply pending migrations
pnpm db:reset      # DROP public + drizzle ledger, then re-migrate from zero
pnpm db:seed       # settings row, 8 start times, 3 dispatch recipients (idempotent)
pnpm db:setup      # reset + seed
pnpm test          # vitest against TEST_DATABASE_URL
pnpm test:holds-soak   # 50-parallel hold race, N times (default 20)
```

### Connecting to Supabase

1. Put the **session pooler** string (port **5432**) in `DATABASE_URL`.
   Not the transaction pooler (6543): advisory locks do not survive there, and
   `create_booking_hold()` depends on them. Not the direct
   `db.<ref>.supabase.co` host either — IPv6-only, unreachable from most CI.
2. `pnpm db:check` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm db:check`.
3. Keep `TEST_DATABASE_URL` pointed at a **local** database. The suite truncates
   tables on every run.

`pnpm db:check` exists because the failure modes here are quiet ones: a pooler
that silently drops prepared statements, a role that cannot read its own
tables, a half-applied migration. It checks all of them and names the fix.

---

## 3. Design tokens

Defined once in [src/app/globals.css](src/app/globals.css) as CSS custom
properties, then mapped into Tailwind via `@theme inline`. **Never hardcode a
hex value in a component** — add a token first.

| Token                                     | Value                                                   | Tailwind             |
| ----------------------------------------- | ------------------------------------------------------- | -------------------- |
| `--brand-gradient`                        | `linear-gradient(135deg,#22e0d6,#34c8ff)`               | `bg-brand`, `text-brand` |
| `--accent`                                | `#0b8fa3`                                               | `text-accent`, `bg-accent` |
| `--accent-light`                          | `#7ff2ea`                                               | `*-accent-light`     |
| `--ink`                                   | `#0b2a3d`                                               | `text-ink`           |
| `--ink-deep`                              | `#04141f`                                               | `text-ink-deep`      |
| `--muted` / `--muted-2` / `--muted-3`     | `#4a6577` / `#587488` / `#5f7c8e`                       | `text-muted*`        |
| `--surface`                               | `#ffffff`                                               | `bg-surface`         |
| `--border`                                | `rgba(11,42,61,.09)`                                    | `border-border`      |
| `--footer`                                | `#04202f`                                               | `bg-footer`          |
| `--shadow-card`                           | `0 12px 34px rgba(11,42,61,.06)`                        | `shadow-card`        |
| `--shadow-cta`                            | `0 16px 40px rgba(34,224,214,.36)`                      | `shadow-cta`         |
| `--radius-card` / `-input` / `-pill`      | `24px` / `14px` / `999px`                               | `rounded-card` etc.  |

**Composite backgrounds** — `bg-page`
(`radial-gradient(1100px 640px at 82% -8%,#d3ecf6 0%,transparent 58%)` over
`linear-gradient(180deg,#f5fafd 0%,#e9f3f8 62%,#e1edf4 100%)`, applied to
`<html>`) and `bg-dark-panel`
(`repeating-linear-gradient(135deg,#0a2c46 0 16px,#0c3654 16px 32px)`).

**Extra utilities** — `glass` (translucent + blur), `glass-header` (the header's
`rgba(245,250,253,.82)` + blur), `tap-target` (44x44 minimum), `shell` (centred
max-width column carrying the gutter), `section-x` / `section-y` (inline gutter
`clamp(18px,4vw,48px)` / block rhythm), `snap-row` (horizontal snap carousel),
`text-display` / `text-h2` / `text-body` (the fluid type scale).

**Layout vars** — `--gutter` (the single inline gutter for every section),
`--header-h`, `--summary-sticky-top`, and `--breakpoint-wide: 900px` giving the
**`wide:`** variant. 900px is the one place this design stops being a phone
layout: the header swaps to its desktop row AND the booking flow swaps from a
wizard to two columns. One breakpoint, one name — do not add a second token at
the same value.

### Contrast: `--accent` vs `--accent-strong`

`--accent` (#0b8fa3) is **3.84:1 on white — it fails WCAG AA for text under
18.66px**. Use `--accent-strong` (#0a7a8c, 5.03:1) for small text such as
kickers and eyebrow tags. `--accent` remains correct for icons, fills, borders
and large text. Likewise `--muted-3` (#5f7c8e) is 4.41:1 and fails as small
text — use `--muted` (6.14:1) or `--muted-2` (4.92:1) instead.

**Animations** — `animate-floaty` (6s, translateY -10px), `animate-rise-in`
(.8s, opacity + translateY 18px), `animate-shimmer` (skeleton sweep, animates
`inset-inline-start` so it travels with the reading direction). All are
disabled under `prefers-reduced-motion`.

### Typography

Role tokens `--font-body` / `--font-display` are remapped per locale by a
`:lang(ar)` rule, so components just use `font-sans` / heading tags:

| Locale | Body                | Headings            |
| ------ | ------------------- | ------------------- |
| `en`   | Manrope 400/600/700 | Sora 600/700/800    |
| `ar`   | IBM Plex Sans Arabic 400/500/600/700 | IBM Plex Sans Arabic |

All self-hosted via `next/font` (zero requests to Google), `font-display: swap`.

---

## 4. RTL discipline — non-negotiable

Arabic is the **default** locale. Layouts must mirror automatically; nothing
should ever need retrofitting.

**Never use physical-direction classes:**

`ml-*` `mr-*` `pl-*` `pr-*` `text-left` `text-right` `left-*` `right-*`
`border-l*` `border-r*` `rounded-tl*` `rounded-tr*` `rounded-bl*` `rounded-br*`
`float-left` `float-right` `clear-left` `clear-right` `origin-left`
`origin-right` `scroll-ml*` `scroll-mr*` `scroll-pl*` `scroll-pr*`

**Use logical equivalents instead:**

| Physical         | Logical              |
| ---------------- | -------------------- |
| `ml-4` / `mr-4`  | `ms-4` / `me-4`      |
| `pl-4` / `pr-4`  | `ps-4` / `pe-4`      |
| `left-0` / `right-0` | `start-0` / `end-0` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `border-l` / `border-r` | `border-s` / `border-e` |
| `rounded-tl` / `rounded-tr` | `rounded-ss` / `rounded-se` |

`top-*`, `bottom-*`, `inset-x-*`, `space-x-*` and `justify-start/end` are fine —
they are block-axis or already logical.

**This is enforced by a lint rule**, not a convention:
[eslint-rules/no-physical-direction.mjs](eslint-rules/no-physical-direction.mjs).
It scans *every* string literal and template chunk (not just JSX `className`),
because variant maps like `const variants = { primary: "ms-2" }` live outside
JSX. `pnpm lint` fails on a violation, and so does `git commit`.

### Bidi isolation

Numbers, prices, phone numbers, dates and measurements must not be reordered by
the Arabic around them. Wrap them in [`<Bidi>`](src/components/ui/Bidi.tsx),
which applies `unicode-bidi: isolate` plus **`dir="auto"`**:

```tsx
<p>السعر <Bidi>QAR 3,500</Bidi> لليوم الكامل</p>
```

Without it the bidirectional algorithm lets surrounding Arabic reorder the run —
a phone number renders with its country code stranded on the wrong end.

**`auto`, not `ltr`** — the direction is resolved from the run's first strong
character, and that distinction is load-bearing. `ltr` is right for a purely
Latin run (`QAR 3,500`, `YW-2026-0001`, an email) and wrong for a value that
carries an Arabic unit: `45 كم/س` forced to LTR puts the unit where an Arabic
reader's eye lands first, so the hero read "km/h 45". `auto` gets both right
with one rule:

| Value | First strong char | Resolves to |
| --- | --- | --- |
| `QAR 3,500` | Latin | LTR |
| `+974 5512 3456` | none | LTR (the fallback) |
| `45 كم/س` | Arabic | RTL — number read first |
| `الخميس، 30 يوليو` | Arabic | RTL |

Isolation applies either way, so the run is still protected from the sentence
around it. Verified by measuring where the first digit actually paints, not by
reading the DOM: `innerText` reports logical order and would look correct while
the screen was wrong.

---

## 4b. Data layer (phase 2)

### Dates — read this before touching anything date-shaped

**A booking reserves a calendar day in Qatar, not an instant.** Every date is an
`IsoDate` string (`"YYYY-MM-DD"`) in a Postgres `date` column. Never a `Date`,
never a `timestamp`. A customer in UTC-5 booking "14 August" must not end up
with the 13th stored.

[src/lib/dates.ts](src/lib/dates.ts) is the **only** place a date is parsed,
formatted or converted. Nothing else may call `new Date(string)`,
`getFullYear()`, `toISOString().slice(0,10)` or similar. If you need an instant
(e.g. "is this slot far enough away?"), use `qatarWallClockToInstant()`.

The test suite runs under **`TZ=Pacific/Kiritimati` (UTC+14)** — deliberately as
far from Qatar as any zone gets — so any code that leaks the host timezone
fails a test instead of shipping. (The dev machine's Postgres happens to be set
to `Asia/Qatar`, which would otherwise make broken code pass.)

### Money

Always an **integer in minor units** (1 QAR = 100 dirhams). Never a float,
never `numeric`. A CHECK constraint enforces
`price_total = rental + setup + delivery`.

### The no-double-booking guarantee

A **partial unique index** on `bookings(booking_date)` covering the six blocking
statuses. Not application code — the database. `cancelled` and `expired` are
excluded, so releasing a date frees it immediately while preserving history.

The status list appears twice: in the index
([drizzle/0001_booking_locking.sql](drizzle/0001_booking_locking.sql)) and as
`BLOCKING_STATUSES` in [src/db/schema.ts](src/db/schema.ts). A test asserts they
agree — **update both**.

### Mutating a booking

Go through the SQL functions, not raw UPDATEs:

- `create_booking_hold(...)` — atomically claims a date for `hold_minutes`.
  Takes a per-date advisory lock, sweeps lapsed holds, rejects blackouts, then
  inserts; the unique index is the final arbiter. Raises `date_unavailable`.
- `transition_booking_status(id, to, actor_type, actor_id, metadata)` — the only
  sanctioned status change. Validates the transition, clears `hold_expires_at`,
  and writes the `booking_events` row in the same transaction.
- `expire_stale_holds(date?)` — releases lapsed locks. Idempotent.

A raw `UPDATE bookings SET status = ...` will usually violate the
`hold_expires_at` CHECK constraint. That is intentional.

`booking_events` is append-only — a trigger rejects UPDATE and DELETE.

**Reads use the `active_bookings` view**, never the table, so "occupied" is
defined once and matches the index. The view also hides holds whose lock has
lapsed but which the sweeper has not yet collected, so a date frees the instant
the hold expires.

### RLS

Enabled on every table with **no policies at all** — `anon` and `authenticated`
can do nothing. Customers are anonymous and never query the database directly;
every customer read goes through a route handler using the server-side client.

**Do not add `FORCE ROW LEVEL SECURITY`.** Migration 0002 originally did, and
0003 removes it. FORCE subjects the table *owner* to RLS too — and on Supabase
`DATABASE_URL` connects as `postgres`, which owns these tables. With FORCE on
and zero policies, the application cannot read its own database. It looked fine
locally only because the dev machine connects as a superuser, which bypasses
RLS unconditionally. `pnpm db:check` fails loudly if FORCE ever comes back.

Admin policies land in phase 7, driver policies in phase 9. Add them as new
migrations; do not loosen [drizzle/0002_rls.sql](drizzle/0002_rls.sql).
[tests/rls.test.ts](tests/rls.test.ts) proves the denial holds even for a role
that has been granted full table privileges by mistake.

### Availability

[src/lib/availability.ts](src/lib/availability.ts) is a **pure function** — the
clock, settings and booked dates are all parameters, which is what makes the
lead-time boundary testable to the second. Precedence:
`past` → `booked` → `blackout` → `too_soon` → `available`. Days beyond
`max_advance_days` are omitted entirely rather than given a state.

A day is `too_soon` when its *earliest* slot is `<=` now + `lead_time_hours` —
sitting exactly on the boundary is too soon.

---

## 4c. Booking flow (phase 3)

Lives in [src/components/booking/](src/components/booking/). Two layouts, one
set of step bodies ([BookingSteps.tsx](src/components/booking/BookingSteps.tsx))
so they cannot drift: a **4-step wizard below 900px**, **two columns above**.

### State survives a language switch

SRS 3.1 requires it, and the locale switcher is a real navigation that unmounts
the entire React tree — so React state alone cannot survive it.
[BookingProvider](src/components/booking/BookingProvider.tsx) persists the draft
**and the current step** to `sessionStorage` (not localStorage: a stranger's
address should not outlive the session). Hydration happens in an effect, never
during render, or the server HTML would not match.

`draft.locale` follows the URL, because it is the language every notification
for that booking will be sent in.

### Validation

[src/lib/booking/schema.ts](src/lib/booking/schema.ts) is imported by both the
wizard and `POST /api/bookings`. One schema, so a rule cannot be enforced in the
UI and forgotten on the server. Phone numbers go through
`libphonenumber-js/min` — real per-country length/prefix validation, smallest
metadata build.

`StepError` values are **also message keys** under `booking.errors.*`. That is
deliberate: a new failure reason cannot be added without a translation, because
next-intl's typed keys reject it.

### The server never trusts the client

`POST /api/bookings` re-parses with the shared schema, re-checks availability
against the database, verifies the start time is one settings actually offers,
and reads prices from the database rather than the body. The browser's calendar
can be 30s stale (edge cache) or minutes stale in an open tab, so its view of
availability is a hint. A date taken meanwhile returns `409 date_unavailable`
and the client is bounced back to the calendar with its cache dropped.

Phase 3 stops at validation — no hold, no OTP, no payment. `create_booking_hold()`
is already in the database waiting for phase 4.

### Calendar geometry — do not "simplify" this

44px cells and the 18px page gutter **cannot both hold at 320px**: seven cells
need 308px, leaving 12px, and the gutter alone wants 36px. `.calendar-bleed` in
globals.css cancels the gutter on phones and spends the remaining width in a
fixed priority order: cells (308px, never negotiable) → gaps (up to 8px) →
inline padding (up to 16px, from what is left). `--cal-gap` and `--cal-pad`
derive from the *same* slack for that reason; clamping them independently
produced 42px cells at 360px.

`pnpm check:booking` measures the cell floor at 320/360/390/414/768 in both
locales. Run it after touching calendar CSS.

### Calendar accessibility

`role="grid"` + roving tabindex, so a keyboard user leaves the calendar in one
Tab, not thirty-one. Unavailable days use **`aria-disabled`, not `disabled`** —
a `disabled` element is skipped by focus, so a screen-reader user would never
hear that the 14th is booked.

Arrow keys are mirrored in RTL (ArrowRight = previous day), while the grid itself
mirrors for free via CSS grid's inline direction.

While availability is in flight, days render as a neutral **pending** state, not
as `past`. Falling back to `past` made the whole month look unbookable for the
seconds the request took.

---

## 4d. Phone verification (phase 4)

WhatsApp OTP, required before checkout (SRS 3.5). Lives in
[src/lib/otp/](src/lib/otp/) with the UI in
[OtpField.tsx](src/components/booking/OtpField.tsx).

### Channels

`OtpChannel` has two implementations, chosen by `OTP_CHANNEL`:

- `whatsapp` — WhatsApp Cloud API, **required in production**
- `console` — logs the code; development only

`createOtpChannel()` **throws** if production resolves to `console`. A
deployment that silently logged one-time codes to stdout would look like it was
working, so the failure is loud and immediate.

Provisioning (Meta business verification, template approval, billing) is the
client's job and cannot be done from the codebase — see
[docs/whatsapp-setup.md](docs/whatsapp-setup.md). Authentication templates are
billed per message, which is part of why the rate limits below are tight.

### Rate limits live in SQL, not Node

`request_otp()` in
[drizzle/0004_otp_rate_limits.sql](drizzle/0004_otp_rate_limits.sql) enforces all
four limits (1/60s and 5/hour per phone; 20/hour and 3 distinct phones/hour per
IP) **and** inserts the row, under a per-phone advisory lock.

Every limit is a read-then-write. Checked in application code, two simultaneous
requests both read "0 sends in the last minute" and both proceed — the limit
quietly becomes "1 per 60s per concurrent request". Do not move these into Node.

Superseded codes are marked **expired, not deleted**: the rows are the history
the limits count, so deleting them would let a customer reset their own quota by
asking for another code.

`retry_after` is computed from real timestamps so the UI can show a true
countdown.

### The token is bound to the phone

`/api/otp/verify` issues a 30-minute HMAC-signed, HttpOnly cookie.
`verifyOtpToken(token, expectedPhone)` **always** takes the number being acted
on and rejects a mismatch. Without that, a token would only prove "some number
was verified" — an attacker could verify their own number and book against
somebody else's. `POST /api/bookings` returns
`403 phone_not_verified {reason:"phone_mismatch"}` in that case.

`OTP_TOKEN_SECRET` must be 32+ chars; rotating it invalidates every in-flight
verification.

### Other properties worth not breaking

- **4 digits** (SRS 3.5) is only 10,000 possibilities, so the bcrypt hash is not
  what makes this safe against guessing — the **5-attempt cap** is, and it is
  enforced in the same transaction as the comparison. Exhausting it burns the
  code, so even the correct one stops working.
- `devEchoEnabled()` requires `OTP_DEV_ECHO === "true"` **AND**
  `NODE_ENV !== "production"`. A production build that inherits the flag still
  returns nothing.
- Verification is keyed to the **number**, not a boolean:
  `isPhoneVerified(draft)` compares `verifiedPhone` against the number currently
  entered, so editing the field revokes verification with no separate
  invalidation path to forget. `verifiedPhone` is client UI state and is never
  trusted by the server.
- `OtpField` is keyed on the phone number by its parent, so a change remounts it
  rather than an effect resetting six pieces of state.

---

## 4e. Checkout holds (phase 5) — the highest-risk code here

SRS 3.2 and 4.3. A date is locked for `settings.hold_minutes` (10) during
checkout and permanently on payment. **Zero overlaps, under any concurrency.**

### Three layers, and why each exists

1. **A per-DATE advisory lock**, `pg_advisory_xact_lock(4242, epoch_day)`. Same
   date serialises; different dates never touch. This is what makes the
   availability re-check meaningful — the check happens *after* the lock, so
   nothing can change underneath it.
2. **The availability re-check, entirely inside the lock.** Past, lead time,
   horizon, blackout, occupancy.
3. **The partial unique index from 0001**, as the backstop. Not decoration: it
   is the only layer that still holds if a future migration, an admin tool or a
   hand-written query inserts a booking without going through the function.

All of it is in `create_booking_hold()`
([drizzle/0005_booking_holds.sql](drizzle/0005_booking_holds.sql)), one
transaction, one round trip. **Do not move any of this into TypeScript.**

The lock key is the **epoch day number**, not `hashtext()`. 0001 used hashtext,
which can collide — harmless for correctness but it silently destroys the
per-date parallelism and makes "date X does not block date Y" untestable.

### The availability rules are duplicated — keep them in step

`create_booking_hold()` and `computeAvailability()` in
[src/lib/availability.ts](src/lib/availability.ts) implement the same rules,
including the `<=` on the lead-time boundary. If they drift, the calendar offers
dates the server then refuses.

### Refusals are not errors

`create_booking_hold()` returns a ROW with an `error_code`, it does not raise.
A lost race is normal operation. The endpoint maps:
`DATE_TAKEN` → **409** (retry with another date), everything else → **422** (the
date was never bookable, so retrying unchanged fails identically). **Never 500.**

### Expiry: belt and braces

- **pg_cron**, every minute — scheduled automatically on Supabase (verified
  active). Where pg_cron is unavailable, schedule `POST /api/cron/sweep-holds`
  (guarded by `CRON_SECRET`) instead.
- **`active_bookings` ignores lapsed holds**, so a missed sweep never blocks a
  customer. The sweep exists to reconcile rows and free the index, not to keep
  the calendar honest.
- **`create_booking_hold()` sweeps the date itself** before inserting, so a
  dead hold cannot make a free date look taken.
- An in-flight payment is marked **`abandoned`, never deleted** — a payment row
  is evidence money may have moved.

### UI

The hold is persisted to sessionStorage **separately from the draft**. That is
what makes the one-tap retry work: when a hold lapses the answers are untouched,
so the recovery screen re-runs `create()` against inputs that never went
anywhere. Never dump the customer back to an empty form.

The countdown ticks against the **absolute** `holdExpiresAt`, not a client-side
duration — a duration drifts when a tab is suspended and could show time
remaining after the server had already released the date. It also re-checks on
`visibilitychange`, because a backgrounded tab has its timers throttled.

### Testing this properly

`pnpm test:holds-soak [runs]` runs the 50-parallel test N times (**20/20 passing**).
A single green concurrency run proves very little.

The tests use a **pool of independent connections**. `Promise.all` over one
postgres.js connection is pipelined onto a single backend and serialises for
free, which would make a broken implementation look correct.

**Direct-SQL tests are not sufficient.** All of them passed while the HTTP
endpoint returned 500, because `RETURNS TABLE` hands `hold_expires_at` back as a
string and the mapping called `.toISOString()` on it. There are now tests that
exercise `createHold()` itself for exactly this class of fault.

---

## 4f. Payments (phase 6)

SRS 3.3. A hold becomes a booking only when money has actually moved, and the
only thing that decides that is **the webhook**.

### The provider is behind an interface

[src/lib/payments/provider.ts](src/lib/payments/provider.ts) is the whole
boundary. Swapping SkipCash for MyFatoorah or Stripe is one new class and one env
var; no booking, hold or settlement logic moves. `PAYMENT_PROVIDER=skipcash|mock`,
and **`mock` throws in production** — a deployment that confirmed bookings while
taking no money would look like it was working.

`verifyWebhook` takes `{ rawBody: string, headers }`, not a parsed object.
Signatures are computed over exact bytes and re-serialising JSON changes them.
The route reads `request.text()` once and passes it straight through.

⚠️ **The SkipCash wire format is UNVERIFIED.** No merchant account exists —
onboarding, fees and subscriptions are the client's responsibility per the SRS
operational notice. Two things are marked `ADJUST-ON-SANDBOX` in
[src/lib/payments/skipcash.ts](src/lib/payments/skipcash.ts): the ordered field
list for the request signature, and the webhook body field names.
`pnpm payments:probe` prints the exact string being signed. What is *not*
guesswork is the part that protects the money — verify before parse, timing-safe
compare, reject unsigned.

### Money

**Integers in minor units, never floats.** The amount is **recomputed
server-side** from the booking row (itself priced from `settings` at hold time).
The client never sends an amount and is ignored when it does — the E2E run posts
`amount: 1` on purpose to prove it. Currency is stored on the booking.
`fromDecimalString()` exists because `19.99 * 100` is not `1999`.

### The webhook is the only thing that confirms

Order in the route is load-bearing: read raw text → **verify signature** → only
then settle. Unsigned or wrongly-signed gets **401 and is never parsed**, and the
body is deliberately *not* logged: it is attacker-controlled and could contain
card-shaped data planted to get it written to our logs.

Status codes: **200** once a signed event is recorded, *including* duplicates and
unknown payments — a 4xx/5xx makes the provider retry, and retrying cannot fix an
event we already handled. **500 only for genuine faults**, where the retry helps.

Idempotency is a `UNIQUE (provider, event_id)` constraint on `payment_events`, not
a check-then-insert. Settlement, booking status, hold release, audit row and the
notification outbox are one transaction in
[drizzle/0006_payments_settlement.sql](drizzle/0006_payments_settlement.sql) —
a confirmed booking with no notification queued is not an acceptable state.

**Never move a booking backwards from confirmed.** A failure event arriving after
a success returns `ignored_after_success`.

### Failure leaves the hold alone

A failed payment does **not** cancel the booking. The hold stands until its
natural expiry, so a customer whose card was declined can just try again.

### The late-payment policy (a real decision, not an oversight)

A payment can succeed after its hold lapsed and the date was given to somebody
else. `settle_payment_success()` tries to revive the booking under the per-date
advisory lock; if the partial unique index raises `unique_violation` it sets
`payments.refund_required` with a reason and queues an admin notification.
**Refunds are deliberately not automated** — a human moves money back.

### Never confirm from a browser redirect

A return URL is trivially forgeable. `/booking/success/[reference]` **polls**
`/status` (1.5s), and after 10s adds `?fallback=1`, which asks the provider
directly — and even then settles through the *same* SQL the webhook uses, so a
recovered booking is confirmed by server-side evidence.

`useCheckout` navigates with `window.location.assign` — **same tab**. Opening a
payment page in a new window loses context in iOS Safari and users assume the
payment broke. It also stays in `paying` state deliberately, to prevent a second
payment.

### Recovery from a lost webhook

`POST /api/cron/reconcile-payments` (guarded by `CRON_SECRET`) finds payments
stuck in `initiated` past a 30-minute grace period and asks the provider what
happened. Schedule it every 10–15 minutes. This is what makes a lost webhook a
delay rather than a lost booking.

### Verification (all of it against real HTTP + real Postgres)

```bash
pnpm payments:e2e       # hold → checkout → signed webhook → confirmed → date gone (24 checks)
pnpm payments:recovery  # lost webhook recovered by ?fallback=1 AND by the cron job
pnpm check:success      # success/failed pages, 320-414px, both locales, in Chrome
pnpm payments:probe     # prints the exact SkipCash signing string
```

`POST /api/payments/mock-checkout?ref=…&status=paid` is the dev-only "money moved
but the webhook vanished" switch — the one state the webhook path cannot produce
itself, and therefore the only way to prove the two recovery paths actually
recover something. It 404s in production, as does the GET page.

The scripts create fixtures through the **real routes** and then **cancel**
them — `cancelled` is outside both `active_bookings` and the partial unique
index, so the date frees, while `booking_events` (append-only by trigger) keeps
the audit trail. A `DELETE` would fail against that trigger. Their queued
notifications **must** be deleted: they address a real phone number and phase 7's
sender would deliver them.

**Cancel first, delete second.** Since phase 7 the cancel itself fires the status
trigger and enqueues "your booking has been cancelled". Doing both in one
statement — or deleting first — leaves those brand-new rows behind, addressed to
a real Qatari number. This was a live bug; see §4g.

---

## 4g. Notifications (phase 7)

SRS 3.4. Four triggers, two channels, one outbox. **Nothing is ever sent from
inside a request.**

### Outbox and worker, never fire-and-forget

Phase 6 already wrote `notifications` rows in the same transaction that
confirmed a booking; this phase drains them.
[drizzle/0007_notifications.sql](drizzle/0007_notifications.sql) turns the table
into a queue and [src/lib/notifications/worker.ts](src/lib/notifications/worker.ts)
runs `claim → render → send → mark`, triggered by
`POST /api/cron/send-notifications` (`CRON_SECRET`, every minute).

Sending inline would mean a confirmation that depends on the customer's browser
staying open, or on the payment webhook finishing an SMTP round trip before its
timeout — and that webhook must answer 200 fast or the provider retries it.

### The three things that must not be got wrong

1. **Claiming is atomic.** `claim_notifications()` uses `FOR UPDATE SKIP LOCKED`
   and increments `attempts` **at claim time**, not on failure — a send that
   crashes the process has still consumed an attempt, so a poisonous message
   cannot be retried forever. A stale `claimed_at` (default 5 min) is reclaimed.
   A SELECT-then-UPDATE in Node is a race whose symptom is two identical
   WhatsApp messages.
2. **Idempotency is a unique index** on `(booking_id, template_key, recipient)`,
   not a check-then-insert. That is what lets every path enqueue freely: the
   settlement function, the status trigger and a phase-8 admin action can all
   ask for "booking_confirmed to this customer" and exactly one row exists.
3. **Backoff lives in SQL.** `notification_backoff(attempts)` → 1m, 5m, 15m, 1h,
   6h, held as data because these are an operational decision, not a formula. A
   retry time in a Node timer dies with the process.

Five attempts, then `failed` + an admin alert. `mark_notification_failed()` will
not alert about the alert — a broken mail provider would otherwise enqueue
alerts about alerts forever.

**Retryable vs not is a real distinction.** 5xx/429/network → retry. Any other
4xx → give up immediately: a rejected template or a bad address fails identically
four more times and only delays the admin finding out by six hours.

### The status trigger, not a function call

`bookings_notify_status_change` fires `AFTER UPDATE OF status`. A trigger rather
than a call inside `transition_booking_status()` because `settle_payment_success`
writes `UPDATE bookings SET status='confirmed'` directly, and phase 8 will add
admin actions of its own. Hanging it off the column means every path notifies,
including ones not written yet, and none of them has to remember.

`confirmed` also notifies admins; the later transitions do not — they watch the
dashboard. Assigning a driver rides the same transition via
`enqueue_driver_assignment()`.

### The payload is frozen, the template is not

`booking_notification_payload()` snapshots everything at enqueue time. A message
sent after a retry must describe the booking **as it was**; reading the live row
would let a cancelled booking render a confirmation. Rendering, by contrast,
happens at SEND time, so a template fix reaches every message still queued.

### Email is written for Outlook, not for a browser

[templates/components.tsx](src/lib/notifications/templates/components.tsx) is all
`<table>` and inline styles. Outlook renders with the **Word** engine: no
flexbox, no grid, no `max-width` on divs. Gmail strips `<style>` blocks in
several contexts. Remote images are blocked by default, so the mark is type, not
an `<img>`.

**`theme.ts` duplicates the design tokens as literal hex, and that is allowed
only there** — `var(--accent)` cannot resolve in an email. The gradient sets
`background-color` *and* `background-image` on the same element so Word keeps the
solid.

Direction is explicit (`align`/`textAlign` from the locale), because logical
properties are not available. The reference is wrapped in `dir="ltr"` — the email
equivalent of [`<Bidi>`](src/components/ui/Bidi.tsx).

`createTranslator` from next-intl, not `getTranslations`: the worker has no
request context. Strings live in the `notifications` namespace of the normal
catalogue, which is **not** in `CLIENT_NAMESPACES`, so none of it ships to a
browser.

### The WhatsApp parameter contract

[whatsapp-params.json](src/lib/notifications/templates/whatsapp-params.json) is
the single source of truth for parameter **order**. Both the registry and
`pnpm gen:whatsapp-templates` read it, so the body Meta approves and the array we
send cannot drift.

Meta requires placeholders to run `{{1}}..{{n}}` **gapless**, and rejects a send
whose count differs from the approved body (`#132000`). The generator fails the
build on a declared parameter the copy does not use — it caught exactly that
while this phase was being written, in five of the seven templates.

`docs/whatsapp-templates.md` is **generated**. Do not edit it by hand.

### Verification

```bash
pnpm notifications:e2e      # 27 checks: paid booking → worker → sent → resend
pnpm gen:whatsapp-templates # regenerate the Meta submission doc
pnpm dev                    # then /dev/emails — every template, both locales
```

**Not verified, and cannot be here:** no real email and no real WhatsApp
notification has been sent — neither account exists. The templates have also not
been opened in Gmail, Outlook or Apple Mail; the constraints those clients impose
are asserted by tests, which is not the same as looking. See
[docs/notifications-setup.md](docs/notifications-setup.md).

### Two things carried forward

- **`booking_setup_complete` has no matching `booking_status`.** The SRS lists
  "setup complete" as a status update, but the enum goes
  `assigned → en_route → completed`. The template exists and is reachable via
  `enqueue_booking_notifications(id, 'booking_setup_complete', false)`; phase 9's
  driver view should call it when the crew marks setup done, rather than an
  enum value being invented for it.
- **`ADMIN_API_SECRET` and [src/lib/admin/auth.ts](src/lib/admin/auth.ts) are a
  placeholder.** They exist only so the log and resend endpoints are not public
  before phase 8 builds real session auth. Delete both then.

---

## 4h. The back office (phase 8)

SRS 3.3. Five screens, mandatory MFA, and the project's first real
authorisation question: **which rows may this person see?**

### Three layers of gate, each catching what the others cannot

| Layer | Sees | Catches |
| --- | --- | --- |
| [src/proxy.ts](src/proxy.ts) | the session cookie only | an anonymous request, before any route runs |
| `(dashboard)/layout.tsx` | cookie + database | no MFA, or no role |
| `requireAdmin()` in every API route | cookie + database | a fetch, which no layout runs for |

Removing any one leaves a hole. The proxy has no database, so it cannot ask
about MFA or roles; the layout does not run for a fetch; the routes do not run
for a page.

**An API route must never answer with a redirect.** `fetch` follows redirects by
default, so a redirect-to-login becomes a 200 carrying the login page —
indistinguishable from success to anything checking `response.ok`.
`pnpm check:admin-auth` caught exactly that on its first run.

### Identity and authorisation are separate

Supabase Auth proves **identity**; the `user_roles` table grants
**authorisation**. A signed-up user with no row sees nothing.

The role is read **on every request**, not from a JWT claim. A claim only
refreshes when a token is reissued, so revoking access would leave someone an
admin for up to an hour. `DELETE FROM user_roles` takes effect on the next
query.

MFA is expressed as Supabase's assurance level: `aal1` is "password accepted",
`aal2` is "and a second factor was verified". `getAdminSession()` treats an
`aal1` admin session as **signed out**, so the enrolment screen cannot be
skipped by a client that simply does not render it.

### RLS is on the hot path, not decorative

`asUser()` in [src/lib/admin/session.ts](src/lib/admin/session.ts) runs
back-office reads inside a transaction that switches to the `authenticated`
role and sets the same `request.jwt.claims` GUC PostgREST would. The policies
from [drizzle/0008_admin_auth.sql](drizzle/0008_admin_auth.sql) then govern the
query itself — a missing `WHERE` clause cannot leak another driver's booking,
because the database refuses to return it.

That is also what makes `tests/admin-rls.test.ts` meaningful: 0008 creates an
`auth.uid()` identical to Supabase's when one is absent, so the test can
impersonate a user exactly as a real request does. The tests do **not** run as
the table owner — that is a superuser locally and would bypass RLS
unconditionally, the same false pass that hid the FORCE mistake in phase 2.

The role lookups (`auth_is_admin()`, `auth_driver_id()`) are **SECURITY
DEFINER with a pinned `search_path`**. A policy on `bookings` that selected from
`user_roles` directly would consult that table's own policies and recurse; and a
definer function without a pinned path is the classic escalation hole.

**Writes take a different path, deliberately.** They go through the SQL
functions — `transition_booking_status`, `assign_driver`, `add_blackout_date` —
which hold invariants the back office must not skip, and which have EXECUTE
revoked from PUBLIC. Each is preceded by a read of the booking under RLS: if the
caller cannot see it, they cannot write it.

### The state machine is enforced where it cannot be argued with

`ADMIN_TRANSITIONS` in [src/lib/admin/types.ts](src/lib/admin/types.ts) exists
so the UI knows which buttons to draw. It is **not** the safeguard — the SQL
function raises `illegal_transition` regardless, so a hand-written POST is
refused too. `tests/admin-transitions.test.ts` checks **all 64 combinations**
against the real function, so drift is a test failure rather than a support
ticket.

A refused transition writes no event and queues no notification: it all happens
in one transaction, so nobody is told about a change that did not happen.

### types.ts is NOT server-only, and that is the point

Client components need the status list to render a filter and the transition map
to decide which buttons exist. Importing those from `queries.ts` or
`mutations.ts` pulls the database client into the browser bundle — Turbopack
fails the build and is right to. Anything both sides need lives in `types.ts`,
which touches no database and reads no environment variable.

### Mobile shapes, not shrunken desktop ones

- **Bottom tab bar below 900px**, sidebar above. The ops person is dispatching
  one-handed on a Saturday; four destinations under a thumb, not behind a menu.
- **The calendar becomes an agenda list.** A 7-column grid with content needs
  ~90px per column; at 390px that is 55px and the chips are unreadable slivers.
- **The orders table becomes a card list.** Seven columns on a phone leaves only
  unreadable type or horizontal scrolling, and the second hides data behind a
  gesture nobody discovers.
- **Confirmations are a `<dialog>` bottom sheet, never `confirm()`** — a browser
  dialog appears at the top of the screen on iOS, nowhere near the thumb that
  triggered it, and cannot explain that the customer is about to be messaged.
- Pull-to-refresh engages only when already scrolled to the top, and only on
  touch. Anything else fights normal scrolling.

`/dev/admin-nav` renders the real navigation components outside the auth gate so
`pnpm check:admin-layout` can measure them. **`app/dev/layout.tsx` supplies the
document shell** — the root layout is a pass-through with no `<html>` and no
`globals.css`, and without that the guard measured an unstyled page and reported
`wide:` as broken.

### Verification

```bash
pnpm check:admin-auth     # 22 checks: nothing reachable unauthenticated
pnpm check:admin-layout   # tabs, 44px targets, the 900px swap
```

`pnpm check:admin-screens` creates a THROWAWAY admin, computes real TOTP codes
in Node, signs in through the actual login and MFA screens, and drives all five
pages at 390px and 1280px checking for runtime errors, missing translations,
overflow and 44px targets. It deletes the account afterwards and never touches a
real admin's authenticator. **That check is the only thing that catches a
Server/Client boundary mistake**, which is a runtime failure no unit test sees.

### A driver is identified by their number

Dispatch reaches a driver on WhatsApp — the job sheet, the arrival time and the
maps link all go to the number — so the back office adds a driver by name and
number, with no email field at all. `drivers.email` still exists and phase 7
still sends an email copy when one is present, but nothing asks for one.

That makes a duplicate number an operational fault rather than untidy data: two
rows sharing a number means one person gets two job sheets and the dispatcher
cannot tell which assignment is live. `drivers_phone_key` in
[drizzle/0009_driver_phone_identity.sql](drizzle/0009_driver_phone_identity.sql)
enforces it, and the route maps `23505` to a plain "that number already exists".

The form shows a fixed `+974` prefix and keeps only digits, so what is typed and
what is stored are visibly the same number — but
[normaliseDriverPhone](src/lib/admin/driverPhone.ts) still accepts a pasted
international number without doubling the country code, because someone will
paste one out of WhatsApp. Validation is libphonenumber's, not a length check:
`+44 7700 900123` parses cleanly and reaches nobody (it is Ofcom's reserved
drama range), and `tests/driver-phone.test.ts` pins that.

### Traps this phase actually hit

- **A shared leaf component that calls `useTranslations` MUST be
  `"use client"`.** Rendered as a Server Component it resolves through
  `src/i18n/request.ts`, which knows nothing about /admin, falls back to `ar`,
  and throws MISSING_MESSAGE. `StatusPill` and `ContactActions` both did this.
  Server Components in the admin tree use `adminT()` instead. As a backstop,
  request.ts now merges the English `admin` namespace into every locale, so the
  next omission renders instead of crashing.
- **`${JSON.stringify(x)}::jsonb` stores a jsonb STRING, not an object.**
  postgres.js serialises the parameter itself when it sees a jsonb cast, so a
  pre-stringified value is encoded twice; `col->>'key'` then returns NULL for
  everything. Always `::text::jsonb`. Verified in both bare-cast and
  function-argument positions, on local Postgres and on Supabase, with a
  regression guard in tests/payments.test.ts.
- **Supabase MFA:** `listFactors().totp` contains only VERIFIED factors, so an
  abandoned enrolment is invisible there — use `factors.all`. And the friendly
  name must be UNIQUE per attempt, or the second visit gets
  `mfa_factor_name_conflict` (422) and can never enrol.
- **Creating an auth user by hand** needs `confirmation_token`,
  `recovery_token`, `email_change` and `email_change_token_new` set to `''`
  (GoTrue scans them into Go strings and NULL fails at sign-in), and
  `identity_data` built with `jsonb_build_object` in SQL — `auth.identities.email`
  is GENERATED from it, and a double-encoded value makes every sign-in fail with
  "Database error querying schema". See scripts/create-admin.mjs.

---

## 4i. Dispatch (phase 9) — there is NO driver portal

The SRS's "driver view" was replaced, on the client's instruction, by a link in
a WhatsApp message. **Drivers never create an account, never install anything
and never see the dashboard.** Everything a crew needs arrives as a message
containing the job's essentials and a capability URL.

This is why there is no driver login, no driver auth, no driver PWA and no
driver RLS policy: `user_roles` accepts only `'admin'`, `auth_driver_id()` is
dropped, and `tests/dispatch.test.ts` asserts all three so the deleted portal
cannot creep back in. The phase-2 `drivers` table was **renamed** to
`dispatch_recipients` in [drizzle/0010_dispatch.sql](drizzle/0010_dispatch.sql)
— renamed, not duplicated, so there is one list of people.

### The token is the whole authorisation

`/d/[token]` shows a customer's home address to whoever holds the URL, so the
token is treated as a credential rather than an identifier:

- **32 bytes of pgcrypto randomness**, URL-safe, stored **only as a SHA-256
  hash**. SHA-256 rather than bcrypt on purpose — the lookup is an indexed
  equality match on every open, and a 32-byte random secret has no dictionary to
  attack; bcrypt's work factor protects low-entropy passwords, not this.
- **One token per recipient per booking.** That is what makes revocation
  individual and the audit trail meaningful: "who opened it" and "who pressed
  the button" are answerable per person, and taking the supervisor's access away
  leaves the driver's link working.
- **Expires at end of booking day + 24h**, computed in Qatar time by
  `dispatch_token_expiry()`, never from the time the message was sent.
- **Scoped to one booking.** There is no endpoint that lists bookings from a
  token; every query is `WHERE token_hash = $1` and joins outward from that row.
- **Every refusal looks identical from outside.** `not_found`, `expired`,
  `revoked` and `rate_limited` all render a neutral page; only "expired" is
  named, because that tells a legitimate recipient something useful and an
  attacker nothing. Distinguishing them would confirm which tokens exist.
- **noindex, nofollow, no-referrer** in [src/app/d/layout.tsx](src/app/d/layout.tsx).
  The URL *is* the credential, so a referrer header would hand a working key to
  Google Maps the moment the driver taps Navigate.
- **Every open is logged** — dispatch id, hash, IP, user agent, outcome — and
  the rate limits (60/min per IP, 120/min per token) are counted from that same
  log, so there is one source of truth for "who has been hitting this".

### The photo is separate from the status update, deliberately

"Job complete" may carry an optional photo of the finished setup. The status
update is a few bytes and **must not be lost**; the photo is a few hundred
kilobytes and may be. So they are **two requests with two queues**, sharing one
`clientActionId`:

- The status posts to `/api/dispatch/[token]/status`, the photo to
  `…/photo`, and the flush drains status updates **first**. Sharing one queue
  would let a photo that keeps failing on a weak signal hold "job complete"
  behind it, which is exactly backwards.
- Idempotency for both is a unique constraint on `(dispatch_id,
  client_action_id)` — the id is generated once per **tap** and reused by every
  retry, so a queue flushed twice applies once and stores one photo.
- **Compressed on the device** ([compress.ts](src/app/d/[token]/compress.ts)):
  1600px long edge, JPEG quality 0.6, ~150-300KB. The bytes never sent are the
  ones that cannot time out on 4G in a villa driveway. JPEG rather than WebP
  because every iOS Safari in the field can encode it.
- **Stored as bytes in Postgres**, not object storage. Supabase Storage would be
  the obvious home, but no bucket is provisioned and provisioning is the
  client's — the same gap as SkipCash, Resend and WhatsApp. A photo path
  depending on an unprovisioned service would silently drop the driver's
  evidence. A CHECK caps a row at 2MiB and restricts the MIME type to three
  raster formats; `image/svg+xml` is refused because an SVG is a script.
- Photos are readable **only** through `/api/admin/photos/[id]` behind
  `requireAdmin` + RLS. A dispatch token can write one and never read one back,
  so a leaked link is not a window onto other jobs' pictures.

### "On my way" walks two steps, and why

The dispatch fires the instant a payment confirms — before anybody has opened
the back office — so the recipient's booking is normally still `confirmed`, and
the state machine has **no `confirmed → en_route` edge**. `applyDispatchAction`
therefore transitions through `assigned` first when the tap comes from a
`confirmed` booking.

Tapping the button IS taking the job, so recording `assigned` is true rather
than a workaround, and the machine stays intact: two legal steps, both
attributed to the phone that pressed it. **`assigned_driver` is left alone** —
the office decides whose name is on the booking, and setting it here would fire
the trigger that messages a driver already standing in the van.

Without this the job sheet drew a button that always 409'd: the exact UI/SQL
disagreement §4h warns about, and `pnpm dispatch:e2e` is what caught it.

### `setup_complete` still has no status behind it

Carried forward from §4g. The action fires the customer notification and writes
a `booking_events` row at the *current* status; the booking stays `en_route`,
which is true — the crew is on site and not finished. No enum value was invented
for it.

### Offline tolerance

Both queues live in localStorage and are read through `useSyncExternalStore`,
not copied into state in an effect — see
[queue.ts](src/app/d/[token]/queue.ts) for why that distinction is load-bearing
here (a "not synced" badge that flashes on every load is worse than none).
A failed post is kept **only** for 429 and 5xx: any other 4xx will fail
identically forever, and a queue that never empties shows a permanent warning
for something already handled.

### Verification

```bash
pnpm dispatch:e2e      # 27 checks against real HTTP + real Postgres
pnpm test              # tests/dispatch.test.ts — 26 cases
```

The E2E drives the whole path: a confirmed payment fans out to every default
recipient, each gets a distinct token, the page shows the address while a
tampered token shows nothing, the actions move the booking and notify the
customer, a replayed action and a replayed photo each apply once, an oversized
or scriptable image is refused, and revoking one recipient leaves the other's
link working.

---

## 5. Folder structure

```
src/
├── app/
│   ├── layout.tsx              # pass-through root layout (no <html>: locale unknown here)
│   ├── not-found.tsx           # locale-less 404; renders its own document shell
│   ├── globals.css             # design tokens + @theme + utilities + base layer
│   └── [locale]/
│       ├── layout.tsx          # the real shell: <html lang dir>, fonts, intl provider
│       ├── page.tsx            # home (placeholder until the landing-page phase)
│       └── styleguide/         # dev-only design system reference (404s in production)
├── admin/                      # (under app/) the back office; English-only, §4h
│   ├── layout.tsx              # document shell only — login lives here too
│   ├── (dashboard)/            # the gated routes: overview, calendar, orders…
│   ├── login/ · mfa/           # reachable without a session, by design
│   └── auth/signout/route.ts   # POST, never GET
├── d/                          # (under app/) the dispatch job sheet; §4i
│   ├── layout.tsx              # its own shell: noindex, nofollow, no-referrer
│   └── [token]/                # page + JobActions + offline queue + compressor
├── dev/                        # (under app/) locale-less tools; 404 in production
│   ├── layout.tsx              # supplies <html> + globals.css the root lacks
│   ├── emails/                 # every notification template, both locales
│   └── admin-nav/              # the real nav, for the layout guard
├── components/
│   ├── ui/                     # design system primitives, re-exported via index.ts
│   ├── marketing/              # landing-page sections, re-exported via index.ts
│   └── LocaleSwitcher.tsx      # feature components live one level up from ui/
├── i18n/
│   ├── routing.ts              # single source of truth for locales + directions
│   ├── request.ts              # per-request config; loads the message catalogue
│   └── navigation.ts           # locale-aware Link / redirect / usePathname / useRouter
├── api/                        # (under app/) locale-independent route handlers
│   ├── availability/route.ts   # GET ?month=YYYY-MM
│   ├── bookings/route.ts       # POST — validates, requires the OTP token
│   ├── bookings/hold/route.ts  # POST — the 10-minute date lock (§4e)
│   ├── bookings/[id]/checkout/route.ts   # POST — starts payment (§4f)
│   ├── bookings/[id]/release/route.ts    # POST — gives a held date back
│   ├── bookings/by-reference/[reference]/status/route.ts    # GET, ?fallback=1
│   ├── bookings/by-reference/[reference]/calendar/route.ts  # GET — .ics
│   ├── payments/webhook/route.ts         # POST — the ONLY thing that confirms
│   ├── payments/mock-checkout/route.ts   # dev only; 404s in production
│   ├── cron/sweep-holds/route.ts         # POST — CRON_SECRET
│   ├── cron/reconcile-payments/route.ts  # POST — CRON_SECRET
│   ├── cron/send-notifications/route.ts  # POST — the outbox worker (§4g)
│   ├── dispatch/[token]/status/route.ts  # POST — the only write a link can do (§4i)
│   ├── dispatch/[token]/photo/route.ts   # POST — the optional completion photo
│   ├── admin/notifications/route.ts      # GET — the send log (placeholder auth)
│   ├── admin/notifications/[id]/resend/route.ts  # POST — requeue one
│   ├── admin/recipients/…                # the dispatch list, from settings
│   ├── admin/bookings/[reference]/dispatch/route.ts  # POST — add / resend
│   ├── admin/dispatch/[id]/route.ts      # DELETE — revoke ONE recipient's link
│   ├── admin/photos/[id]/route.ts        # GET — one photo's bytes, admin only
│   ├── otp/send/route.ts       # POST — rate-limited code issue
│   ├── otp/verify/route.ts     # POST — issues the verification cookie
│   └── settings/route.ts       # GET public config
├── db/
│   ├── schema.ts               # Drizzle tables + BLOCKING_STATUSES
│   ├── client.ts               # server-only postgres.js pool + drizzle handle
│   ├── queries.ts              # the only queries a customer request can reach
│   └── env.ts                  # DATABASE_URL resolution
├── lib/
│   ├── cn.ts                   # class-name joiner
│   ├── dates.ts                # THE Asia/Qatar date utility — see §4b
│   ├── availability.ts         # pure day-state calculation
│   ├── booking/                # shared zod schema, formatters, holds — §4c/§4e
│   ├── otp/                    # channels, code, phone-bound token — see §4d
│   ├── payments/               # provider interface, skipcash, mock — see §4f
│   ├── notifications/          # outbox worker, transports, templates — §4g
│   ├── dispatch/               # token, job resolution, actions, photos — §4i
│   ├── admin/                  # session + RLS-scoped queries/mutations — §4h
│   └── fonts.ts                # next/font declarations
├── proxy.ts                    # Next 16 middleware: redirects / → /ar
└── global.d.ts                 # types message keys against the real catalogue
messages/                       # ar.json, en.json — flat-ish namespaced catalogues
eslint-rules/                   # custom lint rules
```

**Import rules**

- Use the `@/*` alias (`@/components/ui`), never deep relative paths.
- Import `Link`, `redirect`, `useRouter`, `usePathname` from
  **`@/i18n/navigation`**, never from `next/link` or `next/navigation` — the
  locale prefix is added automatically.
- Import primitives from `@/components/ui` (the barrel), not per-file.

---

## 6. Naming conventions

| Thing                       | Convention             | Example                   |
| --------------------------- | ---------------------- | ------------------------- |
| React components + files    | `PascalCase.tsx`       | `SectionHeading.tsx`      |
| Hooks, utils, config files  | `camelCase.ts`         | `cn.ts`, `fonts.ts`       |
| Route folders               | `kebab-case`           | `app/[locale]/styleguide` |
| Next.js special files       | lowercase (framework)  | `page.tsx`, `layout.tsx`  |
| CSS custom properties       | `--kebab-case`         | `--shadow-cta`            |
| Message keys                | `camelCase`, namespaced| `styleguide.labels.area`  |
| Booleans                    | `is` / `has` / `open`  | `isActive`, `fullWidth`   |
| Types & interfaces          | `PascalCase`           | `ButtonProps`             |
| Component prop types        | `<Component>Props`     | `SheetProps`              |

Every component exports a named export (no default exports except Next.js
route files, where the framework requires them).

---

## 7. Git commit convention

Conventional Commits:

```
<type>(<scope>): <subject>
```

- **Types**: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`,
  `perf`, `build`, `ci`
- **Scope**: the area touched — `ui`, `i18n`, `booking`, `payments`,
  `whatsapp`, `db`, `styleguide`, `config`
- **Subject**: imperative mood, lower case, no trailing period, ≤ 72 chars

```
feat(ui): add bottom sheet primitive with dialog-based focus trap
fix(i18n): preserve scroll position when switching locale
chore(config): enforce logical properties via custom eslint rule
```

Commit only when asked. Branch off `main`; never commit directly to `main` for
feature work. `pre-commit` runs `pnpm lint && pnpm typecheck` — a failing
commit is the hook doing its job, so fix the code rather than passing
`--no-verify`.

---

## 8. Phases completed

- [x] **Phase 0 — Repo scaffold, project memory, design system.**
      Next.js 16 + TS strict + Tailwind v4; `[locale]` routing with `/` → `/ar`;
      self-hosted fonts; design tokens; the RTL lint rule; 11 UI primitives;
      `/styleguide`; this file; `.env.example`.
- [x] **Phase 1 — Public marketing page.**
      Sticky header (one row 320→1920px, full-height nav sheet below 900px),
      hero with connection-aware video upgrade, how-it-works, safety & specs,
      masonry gallery, testimonial snap-carousel, FAQ, footer, and a
      `<BookingSection>` **placeholder** at `#booking`. All copy lives in
      `messages/{en,ar}.json`. Two verification scripts added
      (`check:layout`, `check:lighthouse`).
      **Open items for a later phase:** the hero video is gated behind the
      empty `HERO_VIDEO_SRC` constant in `Hero.tsx` — set it once real footage
      exists at `public/media/hero.mp4`. All imagery in `public/media/` is
      generated placeholder art, not photography.
- [x] **Phase 2 — Database schema + data layer.**
      Drizzle schema (8 tables), hand-written locking SQL, deny-all RLS, seed,
      `GET /api/availability` + `GET /api/settings`, 37 vitest tests against a
      real Postgres. See §4b for the rules that matter.
      **Things a future session cannot infer from the code:**
      - Built and verified against **local Postgres 16**, not Supabase — Docker
        was not running and no Supabase project credentials exist yet. The
        schema is Supabase-ready: Supabase-specific bits (`anon`/`authenticated`
        roles) are guarded with existence checks so the same migrations run on
        both. Point `DATABASE_URL` at a Supabase session-pooler string and run
        `pnpm db:migrate && pnpm db:seed` to bring a real project up.
      - `drivers.user_id` is a bare uuid, not an FK to `auth.users` — that
        schema does not exist outside Supabase and a hard FK would make the
        migrations unrunnable against the test database. Add the FK in phase 9
        as a Supabase-only migration if wanted.
      - Seed pricing reads the brief's "4500/600/350 QAR" as major units and
        stores 450000/60000/35000 minor units. If 4500 was meant to be minor
        units already, change the `qar()` helper in `scripts/db-seed.mjs`.
      - The RTL lint rule was tightened this phase: bare `left`/`right` now
        require a real Tailwind value suffix, so the phrase "right-to-left" in
        prose no longer trips it.
- [x] **Phase 3 — Booking section.**
      4-step wizard below 900px / two columns above, calendar on the live
      availability API, time picker, location (address + geolocation + area
      chips + map picker), details with E.164 validation, price summary
      (sticky desktop / collapsible bottom sheet on mobile), shared zod schema,
      and `POST /api/bookings` that re-validates server-side. See §4c.
      **Things a future session cannot infer from the code:**
      - **The Google Maps picker is unverified.** No
        `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured, so "Pick on map" is
        hidden entirely and `MapPicker.tsx` has never run against a live key.
        Address entry, geolocation and the maps-link field all work without it,
        so the flow is completable. Verify the picker when a key exists.
      - OTP, holds and payment are deliberately absent (phases 4-5). The submit
        button validates and logs; nothing is persisted.
      - Sample data (2 bookings + 1 blackout, early August) was seeded into the
        Supabase project so `check:booking` can exercise the "booked dates are
        unselectable" criterion. Remove it before launch.
      - Availability from the ap-northeast-1 Supabase project takes ~1-5s, which
        is why both browser check scripts wait on
        `[data-availability="loaded"]` rather than `networkidle0`. See the
        latency note in phase 2.
- [x] **Phase 4 — WhatsApp OTP phone verification.**
      `OtpChannel` (WhatsApp Cloud API + console), `POST /api/otp/{send,verify}`,
      all four rate limits enforced atomically in SQL, phone-bound 30-minute
      token now required by `POST /api/bookings`, 4-box OTP UI with iOS
      autofill, and [docs/whatsapp-setup.md](docs/whatsapp-setup.md). See §4d.
      **Things a future session cannot infer from the code:**
      - **No real WhatsApp message has been sent.** The client has not
        provisioned the Meta business account, so `WhatsAppCloudChannel` is
        written against the documented Graph API but unverified. Everything
        else — rate limits, hashing, attempts, token binding, the UI — was
        exercised end to end through the console channel.
      - The iOS keyboard-autofill acceptance criterion therefore cannot be
        confirmed either; it needs a real device and a delivered message.
      - `OTP_CHANNEL=console` + `OTP_DEV_ECHO=true` are set in `.env.local` for
        local work. Both are inert in a production build.
      - Holds and payment are still absent (phase 5); the submit endpoint
        validates, verifies the phone, and logs.
- [x] **Phase 5 — checkout holds.**
      `POST /api/bookings/hold` (10-minute lock), `/release`, `/api/cron/sweep-holds`,
      pg_cron scheduled on Supabase, countdown UI with 60s warning and one-tap
      expiry recovery, and 13 concurrency tests. **50-parallel: 20/20 runs,
      exactly one winner.** See §4e.
      **Things a future session cannot infer from the code:**
      - A hold ends at "ready to pay". No gateway is contacted; SkipCash is
        phase 6.
      - The advisory lock key CHANGED from 0001's `hashtext()` to the epoch day.
        Mixing the two would mean no mutual exclusion, so nothing may go back to
        hashtext without changing every caller.
      - `payment_status` gained `abandoned`. Adding an enum value and USING it in
        one migration is illegal in Postgres, but a plpgsql body is resolved at
        execution, so referencing it inside a function created in the same
        migration is fine. That is why it works.
- [x] **Phase 6 — payments.**
      `PaymentProvider` interface + SkipCash + mock, `/checkout`,
      `/api/payments/webhook` (verify before parse, idempotent by unique
      constraint), polling success/failed pages, `.ics`, reconciliation cron.
      **18 unit tests; 24-check E2E; 12-check recovery run; success pages clean at
      320–414px in both locales.** See §4f.
      **Things a future session cannot infer from the code:**
      - **SkipCash is UNVERIFIED against a live sandbox** — no merchant account
        exists, and onboarding is the client's responsibility (SRS operational
        notice). The two guessed parts are marked `ADJUST-ON-SANDBOX`. Everything
        that protects the money is exercised, because the mock provider signs its
        webhooks for real rather than trusting everything.
      - Therefore the "sandbox from a real phone" acceptance criterion is NOT met
        and cannot be until the client provisions a merchant account. The same
        gap as the WhatsApp Cloud channel in phase 4.
      - The late-payment policy (revive if free, else `refund_required` + admin
        notification, refunds never automated) is a deliberate decision. See §4f.
      - `CRON_SECRET` was missing from `.env.local` until phase 6 — the cron
        endpoints were returning 503, i.e. refusing to run rather than running
        unauthenticated. A value is now set locally; **production needs a
        different one.**
      - Payment fixtures are cancelled, never deleted: `booking_events` is
        append-only by trigger, so a `DELETE FROM bookings` raises.
- [x] **Phase 7 — WhatsApp + email notifications.**
      Outbox + worker (`POST /api/cron/send-notifications`), 1m/5m/15m/1h/6h
      backoff over 5 attempts, idempotent by
      `(booking_id, template_key, recipient)`, 11 templates rendered from React
      to HTML + plaintext in both locales, WhatsApp parameter contract with a
      generated Meta submission doc, `/dev/emails` preview, notifications log +
      resend. **72 unit tests; 27-check E2E.** See §4g.
      **Things a future session cannot infer from the code:**
      - **No real email or WhatsApp notification has been sent.** Neither the
        Resend domain nor the Meta templates exist — both are the client's to
        provision. `ResendEmailProvider` and `WhatsAppCloudSender` are written
        against the published APIs and are unverified, the same gap as SkipCash
        in phase 6 and the OTP channel in phase 4.
      - **The templates have not been opened in a real mail client.** Gmail /
        Outlook / Apple Mail rendering is an explicit acceptance criterion and
        it is NOT met. Tests assert the constraints those clients impose
        (tables, inline styles, no flexbox/grid, no `<style>`, no remote
        images, 600px, solid under the gradient) — asserting the constraints is
        not the same as looking at the result.
      - `@react-email/components` is **deprecated on npm**; only
        `@react-email/render` is installed. The primitives are hand-written,
        which email needs anyway.
      - **`pnpm db:migrate` silently applied nothing** until
        `0007_notifications` was added to `drizzle/meta/_journal.json` — the
        migrator reads the journal, not the directory. It printed
        "✓ Migrations applied". A hand-written migration MUST be registered
        there; 0006 already was.
      - The fixture cleanup ordering bug in §4f (cancel before delete) was
        found by this phase and is fixed in all three cleanup paths.
      - `booking_setup_complete` has no matching `booking_status` — see §4g.
- [x] **Phase 8 — Admin dashboard.**
      Supabase Auth with mandatory TOTP MFA, admin/driver RLS policies, and five
      screens (overview, calendar, orders, booking detail, settings) that are
      bottom-tabbed and card-shaped below 900px. **34 new unit tests (219
      total); 22-check auth guard; 23-check layout guard.** See §4h.
      **Things a future session cannot infer from the code:**
      - **Supabase Auth IS configured and verified end to end.** A real admin
        signs in, enrols TOTP and reaches every screen;
        `pnpm check:admin-screens` reproduces the whole flow headlessly with a
        throwaway account. The project uses the new `sb_publishable_...` key
        format, which @supabase/ssr 0.12.3 handles.
      - `mailer_autoconfirm` is OFF on the project, so creating a user through
        the signup API would email a confirmation link and block the account.
        scripts/create-admin.mjs writes to auth.users directly instead, which is
        what the dashboard's "Auto Confirm User" does.
      - Four runtime traps were found only by signing in — see "Traps this
        phase actually hit" in §4h. Three of them (the client boundary, the
        jsonb encoding, the MFA factor handling) would each have looked correct
        in review.
      - **`ADMIN_API_SECRET` and `src/lib/admin/auth.ts` are gone**, replaced by
        session auth. `scripts/notifications-e2e.mjs` no longer reads the admin
        log over HTTP — it reads `notification_log` directly, because it cannot
        mint a session.
      - Migration 0008 CREATES `anon`/`authenticated` roles and an `auth.uid()`
        when missing, so the policies can be created and tested on a plain
        Postgres. On Supabase all three already exist and are left alone.
      - A driver login is read-only until phase 9: policies grant SELECT on
        their own bookings and nothing else, and `payments`/`notifications`
        name no driver policy at all.
      - `booking_notes` is separate from `booking_events` so a note can be
        deleted without punching a hole in an append-only audit trail.
      - Phase 9 should add a `driver_unassigned` template. Reassignment
        currently reuses the cancellation copy for the outgoing driver, which is
        true but blunt — see `notifyReplacedDriver` in
        src/lib/admin/mutations.ts.
- [x] **Phase 9 — Dispatch (replaces the driver view).**
      No driver portal, no driver login: a WhatsApp message with a capability
      link. `dispatch_recipients` (the renamed `drivers`), `booking_dispatch`
      with one hashed token per recipient, the `/d/[token]` job sheet with
      offline-tolerant actions and an optional compressed completion photo, an
      admin Dispatch panel with send/open/act status, per-recipient revoke and a
      both-languages message preview. **26 unit tests (243 total); 27-check
      E2E.** See §4i.
      **Things a future session cannot infer from the code:**
      - **The scope change was the client's**, not a simplification: the SRS's
        driver view, "Today"/"Upcoming" screens and driver PWA were deleted on
        instruction. `user_roles` accepts only `'admin'` and `auth_driver_id()`
        is gone; three tests exist purely to stop the portal creeping back.
      - **Migration 0011 has NOT been applied to Supabase.** The project was
        unreachable from this machine for the whole session (`CONNECT_TIMEOUT`
        to the ap-northeast-1 pooler), so everything here was verified against
        **local Postgres 16** — a full `db:reset` proved all twelve migrations
        run clean from zero. Run `pnpm db:migrate` against Supabase when it is
        reachable, then `pnpm db:check`.
      - The local test database's drizzle ledger had drifted (0007-0010 applied
        but unrecorded), which made `pnpm db:migrate` try to re-run 0009 against
        an already-renamed `drivers` table. `pnpm db:setup` against
        `TEST_DATABASE_URL` fixed it. If a migration fails with "relation
        drivers does not exist", this is why.
      - **The completion photo is stored in Postgres as `bytea`**, capped at
        2MiB by a CHECK. That is a deliberate trade against Supabase Storage,
        which has no provisioned bucket — see §4i. If a bucket is later created,
        the swap is `storeDispatchPhoto` plus the admin image route, nothing
        else.
      - **The two verifications need opposite servers.** `pnpm dispatch:e2e`
        builds its fixture through the real payment flow, so it needs a DEV
        server (mock is refused in a production build). A browser check of the
        job sheet needs the opposite: under headless Chrome the dev server's
        failing HMR socket leaves the page unhydrated, so every button is inert
        — reproduced on the marketing page too, so it is not a /d bug. Against
        `pnpm build && pnpm start` the sheet renders at 390px, the confirm
        dialog opens, and the photo input carries
        `accept="image/*" capture="environment"`.
      - **No real WhatsApp dispatch has been delivered**, the same gap as phases
        4, 6 and 7 — the Meta templates are the client's to submit. The
        `yw_dispatch_job` body is in docs/whatsapp-templates.md, generated.
      - `driver_unassigned` is **still** missing; reassignment reuses the
        cancellation copy for the outgoing driver. Carried forward from phase 8.
- [ ] Phase 10 — Content, SEO & analytics
- [ ] Phase 11 — Performance & accessibility audit
- [ ] Phase 12 — Launch hardening

> Tick a phase here as the **last** step of that phase, and note anything a
> future session could not infer from the code.

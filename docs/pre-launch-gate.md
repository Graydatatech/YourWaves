# The pre-launch gate

While `SITE_PASSWORD` is set, the public site asks for it before showing
anything. Unset, none of it runs.

**Launching is deleting the variable.** No code change, no flag to flip in a
file somebody has to remember. Remove it in Vercel, redeploy, the site is open.

---

## Setting it

### Locally

Add to `.env.local`:

```bash
SITE_PASSWORD="pick-something-shareable"
```

Restart `pnpm dev` — the proxy reads the variable at request time, but Next
only picks up a new `.env.local` on boot.

Leave it out (or blank) and the gate is inert, which is what you want for
day-to-day work.

### On Vercel

**Settings → Environment Variables → Add**

| Field | Value |
| --- | --- |
| Key | `SITE_PASSWORD` |
| Value | the passphrase |
| Environments | **Production** (and Preview, if previews should be gated too) |

Then **redeploy** — environment changes do not reach a running deployment.

To launch: delete the variable and redeploy.

---

## Two ways in

**The form at `/access`.** Anyone hitting a gated page is redirected there with
`?next=` carrying where they were going. A correct password sets a signed,
HttpOnly cookie good for 14 days and puts them back.

**HTTP Basic.** For an uptime check, a `curl`, a Lighthouse run:

```bash
curl -u anything:the-password https://yourwaves.qa/ar
```

Any username; only the password is compared. Inventing a username would be a
second secret to communicate and would protect nothing.

---

## What is never gated

Getting this list wrong is the failure mode of a pre-launch gate: it is
invisible in a browser, because a human always arrives through the front door,
and it silently breaks the machines that arrive through the side.

| Path | Why |
| --- | --- |
| `/api/*` | SkipCash's payment webhook and the three Vercel crons have no cookie jar and no way to be told a password. Gating them means bookings that never confirm and an outbox that never drains — neither of which looks like a locked site. Both already authenticate: the webhook by HMAC, the crons by `CRON_SECRET`. |
| `/admin/*`, `/api/admin/*` | Supabase Auth with mandatory TOTP is already in front. A shared passphrase adds nothing and risks locking the client out of their own dashboard on launch day. |
| `/d/<token>` | A driver opening a job sheet from a message cannot be handed a site password. The token is the stronger credential. |
| `/r/<token>` | Same, for a customer opening a survey link. |
| `/_next/*`, `/media/*`, `/fonts/*`, anything with a file extension | Or the gate page itself renders unstyled, which is how most people discover they got this wrong. |

Everything else — the marketing page, the booking flow, `/terms`, the success
and failure pages, `/dev/*` — is gated.

---

## What this is not

**It is not a security boundary.** One shared secret, no rate limit, no
per-person identity. It keeps an unfinished site off Google and out of a
forwarded link.

Everything that actually needs protecting is protected elsewhere, and none of
it should be relaxed on the strength of this: the back office by Supabase Auth
plus TOTP, dispatch and survey links by capability tokens, the payment webhook
by an HMAC signature, the customer's own booking by a phone- or email-bound
verification token.

There is deliberately no rate limiting on `/api/access`. If this ever becomes
the only thing in front of something that matters, that reasoning stops holding
and `request_otp()`'s SQL limiter (§4d) is the shape to copy.

---

## Notes

- **Changing the password invalidates every cookie already issued.** The token
  is signed *with* the password, so rotating it is how you revoke access after
  the passphrase has been over-shared.
- **The gate runs before locale routing**, deliberately. Run the rewrite first
  and `/` still redirects to `/ar`, which tells a stranger the site exists, is
  bilingual, and defaults to Arabic.
- **`/access` sits outside the `[locale]` segment** and carries its own
  document shell, like `/d` and `/r`. Inside it, the locale rewrite would
  bounce the page to `/ar/access` before anyone could type into it. Its copy is
  bilingual for the same reason the locale-less 404 is: somebody arriving there
  has told us nothing about their language.
- **`noindex, nofollow, noarchive`** on the gate page. A page whose job is to
  keep the site out of search results should not be the one thing in it that
  gets indexed.
- **Link previews stop working while the gate is up.** `opengraph-image` is
  under `[locale]` and is gated with everything else. That is the right default
  before launch — a WhatsApp preview of an unfinished site is exactly what this
  exists to prevent.

---

## Implementation

| File | Role |
| --- | --- |
| [src/lib/siteGate.ts](../src/lib/siteGate.ts) | the whole policy: exemptions, token, Basic auth |
| [src/proxy.ts](../src/proxy.ts) | calls it first, before the admin gate and the locale rewrite |
| [src/app/access/](../src/app/access/) | the form, its client component, its document shell |
| [src/app/api/access/route.ts](../src/app/api/access/route.ts) | exchanges the passcode for the cookie |

> Next.js 16 renamed `middleware.ts` to **`proxy.ts`**, and the export is
> `proxy`, not `middleware`. A `middleware.ts` file in this project would never
> run. See CLAUDE.md §2.

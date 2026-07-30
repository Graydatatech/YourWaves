# Notifications — what the client must provision

Phase 7 sends four kinds of message (SRS 3.4) over two channels. Neither channel
works until the client provisions an account, and **both refuse to run with the
development transport in a production build** — a deployment that silently
delivered nothing would look exactly like a working one.

| Channel | Provider | Who provisions it |
| --- | --- | --- |
| Email | [Resend](https://resend.com) (or any provider behind `EmailProvider`) | Client |
| WhatsApp | Meta WhatsApp Cloud API | Client — see [whatsapp-templates.md](whatsapp-templates.md) |

Per the SRS operational notice, accounts, fees and message costs are the
**client's responsibility**, the same boundary as the payment merchant account
and the OTP sender.

## Email

### 1. Verify a sending domain

Resend → **Domains** → add `yourwaves.qa`, then publish the DNS records it
gives you:

- **SPF** (`TXT`) and **DKIM** (`CNAME` ×3) — without these, Gmail and Outlook
  send confirmations to spam, which for a booking confirmation is the same as
  not sending them.
- **DMARC** (`TXT` at `_dmarc`) — start at `p=none` and tighten once the reports
  are clean.

Verification is typically minutes but can take up to 48 hours to propagate.

### 2. Configure

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM="YourWaves <hello@yourwaves.qa>"   # must be on the verified domain
EMAIL_REPLY_TO=hello@yourwaves.qa             # optional
```

`EMAIL_FROM` **must** use the verified domain. Resend rejects anything else with
a 4xx, which the worker treats as permanent — it will not retry, and an admin is
alerted on the first attempt rather than six hours later.

### Swapping provider

Implement `EmailProvider` in
[src/lib/notifications/providers/email.ts](../src/lib/notifications/providers/email.ts)
and add it to the factory. The interface is two lines:

```ts
send(message: { to, subject, html, text, replyTo }) → { providerRef? }
```

Nothing about templates, queueing or retries changes.

## WhatsApp

Reuses the same business number as the phase-4 OTP sender, so if OTP already
works only the templates are new.

```bash
WHATSAPP_PROVIDER=cloud
WHATSAPP_PHONE_NUMBER_ID=...      # same as the OTP channel
WHATSAPP_ACCESS_TOKEN=...         # permanent System User token, not a 24h one
```

**Every template in [whatsapp-templates.md](whatsapp-templates.md) must be
approved first.** Business-initiated messages outside a 24-hour customer service
window are template-only; a confirmation sent minutes after a web payment is not
reliably inside that window, because the customer paid on a page rather than
messaging us.

## Scheduling the worker

Nothing sends until the worker runs. Schedule **every minute**:

```
POST /api/cron/send-notifications
Authorization: Bearer $CRON_SECRET
```

On Vercel, `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/send-notifications", "schedule": "* * * * *" },
    { "path": "/api/cron/sweep-holds", "schedule": "* * * * *" },
    { "path": "/api/cron/reconcile-payments", "schedule": "*/10 * * * *" }
  ]
}
```

Elsewhere, any scheduler that can send an authenticated POST will do, including
Supabase `pg_cron` + `pg_net`.

`CRON_SECRET` is required: with it unset the endpoint answers **503
`cron_not_configured`** and does nothing. It refuses rather than running open,
because each drained row costs real money in WhatsApp template fees.

Running two workers concurrently is safe — claiming is atomic, so the second
finds nothing to take.

`?batchSize=` overrides the default 25 per tick.

## Watching it

```bash
GET  /api/admin/notifications?status=failed
POST /api/admin/notifications/<id>/resend
Authorization: Bearer $ADMIN_API_SECRET
```

> `ADMIN_API_SECRET` is a **placeholder**. Phase 8 replaces it with real admin
> session auth and deletes
> [src/lib/admin/auth.ts](../src/lib/admin/auth.ts).

Anything in `failed` needs a human: the customer did not get that message. The
row records `attempts` and `last_error`, and an admin was emailed when it was
given up on.

## How delivery behaves

| | |
| --- | --- |
| **Retries** | 1m → 5m → 15m → 1h → 6h |
| **Attempts** | 5, then `failed` + an admin alert |
| **Retryable** | 5xx, 429, network faults |
| **Not retryable** | 4xx — bad address, unapproved template, wrong parameter count. Four more attempts would fail identically. |
| **Idempotency** | `UNIQUE (booking_id, template_key, recipient)` |

A permanently failed message alerts admins **once per booking**. The full record
is always in the log; the alert exists to make someone look at it.

## Local development

The defaults need no accounts:

```bash
EMAIL_PROVIDER=console
WHATSAPP_PROVIDER=console
NOTIFICATION_DEV_DIR=.dev-outbox   # rendered HTML written here
```

The console transports print each message and write the email HTML to disk.
Both are a hard error in a production build.

```bash
pnpm dev                    # then visit /dev/emails
pnpm notifications:e2e      # 27 checks: paid booking → worker → sent → resend
pnpm gen:whatsapp-templates # regenerate whatsapp-templates.md
```

`/dev/emails` renders every template in both locales from sample data, through
the same `renderEmail`/`renderWhatsApp` the worker uses. It 404s in production.

## What is NOT verified

**No real email and no real WhatsApp notification has been sent.** Neither
account exists yet, so `ResendEmailProvider` and `WhatsAppCloudSender` are
written against the published APIs but have never been exercised against them.

Everything else — the queue, claiming, the retry ladder, giving up, the admin
alert, rendering in both locales, the parameter contract — is tested against a
real Postgres and a real HTTP server.

The templates have also **not been opened in Gmail, Outlook or Apple Mail**.
They are built to the constraints those clients impose (tables, inline styles,
no flexbox or grid, no `<style>` block, no remote images, 600px, a solid
fallback under the gradient) and a test asserts each of those, but asserting the
constraints is not the same as looking at the result. Send one of each to a real
inbox once the domain is verified.

# Payments — what the client must provision

YourWaves takes card payments through **SkipCash**, the Qatari gateway named in
the SRS. Per the SRS operational notice, **every merchant account, fee,
commission and subscription is the client's responsibility**, not the
developer's. Nothing in this document can be done from the codebase: it needs the
client's commercial registration, bank account and signature.

Until it is provisioned, development runs on `PAYMENT_PROVIDER=mock`, which
simulates the full flow — including signed webhooks — without moving money.

---

## What it costs

SkipCash charges **per successful transaction**, typically a percentage plus a
fixed fee, with the exact rate set in the merchant agreement. There may also be
a setup fee and a monthly minimum. Confirm all of it in writing before launch;
these are commercial terms, not technical ones.

Two things worth knowing because they shape the product:

- **A refund usually does not return the transaction fee.** The late-payment
  policy below is written to minimise refunds for that reason.
- **Settlement is not instant.** Money typically reaches the client's bank on a
  T+1 to T+3 cycle. A confirmed booking in this system means the payment
  *succeeded*, not that the funds have landed.

---

## Step 1 — Merchant onboarding

1. Apply at <https://skipcash.app> as a business.
2. Documents SkipCash will ask for:
   - Commercial Registration (CR) and trade licence
   - Establishment card
   - Qatari bank account details in the business's name
   - ID of the authorised signatory
   - The website URL, with visible pricing, terms and a refund policy
3. Expect **several business days to a few weeks**. Gateways review the website
   as well as the paperwork.

> A gateway will reject or delay an application whose website has no published
> refund/cancellation policy. That page does not exist yet — it is worth writing
> before applying rather than after being asked.

## Step 2 — Sandbox credentials

SkipCash issues sandbox credentials before production. From the merchant
dashboard collect:

| Value | Env var |
| ----- | ------- |
| Sandbox API base URL | `SKIPCASH_API_URL` |
| Client ID | `SKIPCASH_CLIENT_ID` |
| Key ID | `SKIPCASH_KEY_ID` |
| Secret key (signs our requests) | `SKIPCASH_SECRET_KEY` |
| Webhook secret (verifies their callbacks) | `SKIPCASH_WEBHOOK_SECRET` |

```bash
PAYMENT_PROVIDER=skipcash
SKIPCASH_API_URL=https://skipcashtest.azurewebsites.net
SKIPCASH_CLIENT_ID=
SKIPCASH_KEY_ID=
SKIPCASH_SECRET_KEY=
SKIPCASH_WEBHOOK_SECRET=
```

`PAYMENT_PROVIDER` must be a real provider in production — the app **refuses to
start** with the mock in a production build, rather than confirming bookings for
free.

## Step 3 — Register the webhook

In the SkipCash dashboard, set the callback/webhook URL to:

```
https://<your-domain>/api/payments/webhook
```

**This must be a public HTTPS URL.** For a local sandbox test, tunnel it:

```bash
cloudflared tunnel --url http://localhost:3000
# then register https://<tunnel>.trycloudflare.com/api/payments/webhook
```

The webhook is the **only** thing that confirms a booking. Without it registered,
customers will pay and see "confirming your payment" until the reconciliation job
catches up — which works, but is a poor experience and up to 30 minutes late.

## Step 4 — Verify against the sandbox

> ⚠️ **The SkipCash wire format in this codebase is unverified.** No merchant
> account existed when it was written, so `src/lib/payments/skipcash.ts` follows
> SkipCash's published integration pattern but has never been exercised against
> their servers. Two things are most likely to need adjusting, both marked
> `ADJUST-ON-SANDBOX` in that file:
>
> 1. the ordered field list used to build the request signature
> 2. the field names on the webhook body
>
> Everything security-relevant — verify-before-parse, timing-safe comparison,
> rejecting unsigned calls, idempotency, transactional settlement — is provider
> independent and fully tested.

Once credentials exist:

```bash
pnpm payments:probe checkout    # create a sandbox checkout, print the pay URL
pnpm payments:probe status <ref>   # read a transaction back
```

The probe prints the exact string it signed, which is what you need to compare
against SkipCash's documentation if authentication fails.

Then run the real flow end to end from a phone:

1. Book through to a hold, tap **Pay now**
2. Pay with a SkipCash sandbox test card
3. You should land on `/booking/success/YW-...` showing "confirming", then
   flipping to confirmed within a second or two of the webhook arriving
4. Check the date is now unavailable in the calendar for everyone

## Step 5 — Schedule reconciliation

```
POST /api/cron/reconcile-payments
Authorization: Bearer $CRON_SECRET
```

Every 10–15 minutes. This finds payments stuck in `initiated` past 30 minutes,
asks SkipCash what actually happened, and settles them through the same code path
as the webhook. **It is what turns a lost webhook into a delay rather than a lost
booking.**

`CRON_SECRET` is required, not optional: with it unset the endpoint answers
**503 `cron_not_configured`** and does nothing. It refuses to run rather than
running unauthenticated — an open endpoint here would let anyone trigger
provider queries. Use a **different value in production** from the local one.
`?olderThanMinutes=` overrides the grace period; the recovery script uses a tiny
value so it does not have to wait half an hour.

---

## How the money flow is protected

Worth understanding before changing any of it.

### The browser is never evidence of payment

The success page confirms nothing. Anyone can type
`/booking/success/YW-2026-0001` into a browser. The page polls the server and
shows "confirming your payment" until the **webhook** has settled the booking. If
the webhook is slow, after ~10s the page asks the provider directly — still
server-side, still settled through the same SQL.

### The amount is never taken from the client

The request body carries no amount and one would be ignored. The figure comes
from the booking row, which was priced from `settings` when the hold was created.
A provider that later reports a different amount does not change what we stored;
it records an `amount_mismatch` event for reconciliation.

Money is an integer in minor units everywhere. SkipCash wants a decimal string,
so conversion happens at that boundary and nowhere else — see
`fromDecimalString`, which is tested against the values that break naive
float maths (`19.99`).

### Duplicate webhooks cannot double-confirm

`payment_events` has a UNIQUE constraint on `(provider, event_id)`. The insert
either wins or it does not, atomically — including when two copies of the same
webhook arrive simultaneously on different connections. A duplicate returns
`duplicate_event` and changes nothing, so the customer is not messaged twice.

### Failure keeps the hold

A declined card leaves the booking `holding` until its natural expiry. The
commonest next action after a decline is trying another card, and releasing the
date immediately would hand it to someone else mid-transaction.

### Late payment: revive if possible, refund only if not

**The decision, and why.** A customer can pay after their 10-minute hold lapses —
a slow bank page, 3-D Secure, a dropped connection. Blanket-refunding all of
those would be wrong: usually nobody else took the date, and the customer would
be refunded a booking they successfully paid for and expect to have.

So `settle_payment_success` **tries to reinstate the booking**. The attempt runs
under the per-date advisory lock, and the partial unique index decides: if another
booking now occupies the date, the UPDATE raises `unique_violation` and the code
falls through to the refund path.

- **Date still free** → booking revived to `confirmed`, customer notified
  normally. Outcome `revived`.
- **Date reallocated** → payment stays `paid` with `refund_required = true` and
  `refund_reason = 'hold_expired_and_date_reallocated'`, plus an **admin
  notification**, because a human has to move the money. Outcome
  `refund_required`.

Refunds are deliberately **not** automated. Issuing money back without a person
looking is how a bug becomes a financial incident, and the volume here is low
enough that a human step costs nothing.

Find them with:

```sql
SELECT p.*, b.reference, b.booking_date
  FROM payments p JOIN bookings b ON b.id = p.booking_id
 WHERE p.refund_required;
```

### Card data never reaches us

Payment happens entirely on the provider's hosted page. No PAN or CVV touches
these servers. As a second line, `redactSensitive()` strips card-shaped keys
**and bare 13–19 digit runs under any key name** from every payload before it is
stored or logged — and an unverified webhook body is never logged at all, since
it is attacker-controlled and could contain card-shaped data planted precisely to
get it written to our logs.

---

## Local development without a merchant account

```bash
PAYMENT_PROVIDER=mock
MOCK_PAYMENT_SECRET=<any string>
CRON_SECRET=<any string>
```

Tapping **Pay now** opens `/api/payments/mock-checkout`, a stand-in hosted page
with a pay button and a "simulate a declined card" button. Each posts a
**correctly signed** webhook to the real endpoint, so signature verification,
idempotency and transactional settlement are all exercised locally. That page
404s in production.

The mock is the **default** provider, and it is a hard error in a production
build — so these scripts need `pnpm dev`, not `pnpm build && pnpm start`. That
refusal is deliberate: a deployment that confirmed bookings while taking no money
would look like it was working.

### Proving it works, without a merchant account

```bash
pnpm payments:e2e       # 24 checks: hold → checkout → signed webhook → confirmed
                        #   → date gone; plus 401 on unsigned and wrongly-signed,
                        #   replay is a no-op, late failure cannot un-confirm,
                        #   client-sent amount ignored, one payment row only
pnpm payments:recovery  # 12 checks: a LOST webhook recovered two ways
pnpm check:success      # success/failed pages in Chrome at 320-414px, ar + en
```

These drive the real HTTP routes against the real database, not the SQL functions
directly. That distinction is not academic: in phase 5 every direct-SQL test
passed while the HTTP endpoint returned 500.

To reach the recovery paths you need the one state a webhook cannot produce —
the customer paid and the callback never arrived:

```bash
# dev only, 404s in production: moves the money on the provider's side,
# sends no webhook
curl -X POST "http://localhost:3000/api/payments/mock-checkout?ref=<providerRef>&status=paid"
```

Then either `GET /api/bookings/by-reference/<ref>/status?fallback=1` (what the
success page does after 10s) or the reconciliation cron will recover it. Both
settle through the same SQL the webhook uses, so a recovered booking is confirmed
by server-side evidence and still queues its notifications.

### Fixture cleanup

The scripts cancel their fixtures rather than deleting them: `booking_events` is
append-only by trigger, so `DELETE FROM bookings` raises. `cancelled` is outside
both `active_bookings` and the partial unique index, so the date is genuinely
free again. If a run is interrupted:

```bash
node scripts/e2e-cleanup.mjs
```

Their queued notifications are deleted too, and that part is not optional — they
address a real phone number and the phase-7 sender would deliver them.

## Replacing SkipCash

Implement `PaymentProvider` (`src/lib/payments/provider.ts`) and add it to the
factory in `src/lib/payments/index.ts`. Nothing in the booking, hold or
settlement logic changes — the interface is the whole contract:

```ts
createCheckout(input) → { providerRef, redirectUrl }
verifyWebhook({ rawBody, headers }) → { valid, event }
fetchStatus(providerRef) → PaymentStatus
```

Note `verifyWebhook` takes the raw body **as text**. Signatures are computed over
exact bytes, and parsing then re-serialising JSON changes them.

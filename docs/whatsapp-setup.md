# WhatsApp OTP — what the client must provision

YourWaves sends phone-verification codes over the **WhatsApp Cloud API**. Meta
requires a business account, an approved message template and a payment method
before a single code can be delivered. **None of this can be done from the
codebase** — it needs access to the client's Meta Business account, and the
messaging costs are billed to them (SRS operational notice).

Until it is provisioned, development runs on `OTP_CHANNEL=console`, which prints
codes to the server log and delivers nothing.

---

## What it costs

Authentication-category messages are billed **per message delivered**, per
country. Qatar sits in Meta's higher-priced authentication band — budget on the
order of **USD 0.03–0.09 per code** and confirm the current rate on Meta's
pricing page before launch, because these rates change.

Practical consequences, already built into the code:

- The send endpoint enforces **1 code per 60s and 5 per hour per number**. Those
  limits are a cost control as much as an abuse control — without them a single
  bored visitor can run up a bill.
- The **20 per hour per IP** and **3 distinct numbers per hour per IP** limits are
  what stop someone scripting a loop against the endpoint.
- Codes are **4 digits** (SRS 3.5) with a 5-minute expiry and a hard 5-attempt
  cap, so a failed verification cannot spiral into repeated resends.

Set a **billing alert** on the Meta ad account before going live.

---

## Testing with your own number TODAY (no verification, no billing)

You do **not** need business verification, an approved display name or a payment
method to prove the integration works. Meta gives every new app a **test sender
number** and lets you add up to **5 test recipients** — free, unlimited messages
to those 5.

This is the fastest path to a real WhatsApp message on your phone.

1. <https://developers.facebook.com> → your app → **WhatsApp → API Setup**.
2. **From**: leave Meta's test number selected. Copy the **Phone number ID**
   under it — that is `WHATSAPP_PHONE_NUMBER_ID`.
3. **To**: click *Manage phone number list* and add **your own number**. Meta
   sends it a confirmation code; enter it. **This step is the one people skip**,
   and sends then fail with `(#131030) Recipient phone number not in allowed
   list` even though everything else is correct.
4. Copy the **temporary access token** shown on that page — that is
   `WHATSAPP_ACCESS_TOKEN`. It expires in **24 hours**, which is fine for a test.
   (The permanent System User token in step 3 below is for deployment.)
5. Copy the **WhatsApp Business Account ID** shown on the same page — that is
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, needed only to list templates.

Put those three in `.env.local`, then work through the diagnostics in order:

```bash
pnpm otp:probe check                  # is the token valid? is the sender live?
pnpm otp:probe hello   +974XXXXXXXX   # pre-approved template, no params
pnpm otp:probe templates              # does yourwaves_otp exist and is it APPROVED?
pnpm otp:probe otp     +974XXXXXXXX   # the real authentication template
```

`hello` uses `hello_world`, which is pre-approved on every test account. **If
that message arrives, your token, sender and allow-list are all correct** and
anything still failing is the template — which narrows it enormously.

`pnpm otp:probe` translates Meta's error codes into what to actually fix.

### Creating the template: the UI, not the API

`pnpm otp:probe create-template` exists but **fails on an unverified business**:

```
(#10) Application does not have permission for this action
subcode 2388185
```

Measured on this project's own test setup. The token had
`whatsapp_business_management` and *listing* templates with it worked — so this
is not a missing scope. Template **reads** work with the Standard Access an app
has in Development mode; template **writes** need Advanced Access, which is
gated on business verification (`business_verification_status: not_verified`).

Create it in **WhatsApp Manager → Message Templates** instead. The UI acts with
your own business-admin session rather than through the app's access tier, so it
is not subject to the same restriction.

If the UI also refuses, business verification is genuinely required first — see
step 1, and budget 3–10 days.

### Then run the real flow

Once `pnpm otp:probe otp` delivers, switch the app over:

```bash
OTP_CHANNEL=whatsapp
```

Restart `pnpm dev`, open the booking section, reach step 4, enter your number and
press **Send code**. The message arrives from the test number, and on iOS the
keyboard offers the code above the boxes.

### What still needs the full setup

The test number only reaches those 5 pre-registered recipients. Sending to real
customers needs everything below: business verification, your own registered
number, display-name approval and billing.

---

## Step 1 — Meta Business account and WhatsApp Business Account (WABA)

1. Go to <https://business.facebook.com> and use (or create) the client's
   Business Portfolio. It must be the client's own — a developer-owned account
   cannot be transferred later without re-verification.
2. **Complete Business Verification.** Meta requires legal documents (trade
   licence / commercial registration, and a utility bill or bank statement
   showing the registered address). This is the slowest step: allow **3–10
   business days**, longer if documents are queried.
3. In Meta Business Suite → **WhatsApp Accounts**, create a WABA.

## Step 2 — Register the sending phone number

1. In the WABA, add a phone number. It must **not** currently be registered to
   the consumer WhatsApp app or WhatsApp Business app. If it is, delete that
   account first and wait for it to clear.
2. A landline or a number that can receive an SMS/voice OTP once, for
   verification, is fine. This number becomes the sender the customer sees.
3. Complete **display name review**. Use the trading name ("YourWaves"), not a
   personal name — a rejected display name blocks sending.
4. Note the **Phone number ID** (not the phone number itself) from
   WhatsApp Manager → API Setup. This is `WHATSAPP_PHONE_NUMBER_ID`.

## Step 3 — Create a Meta app and a permanent token

1. At <https://developers.facebook.com> create an app of type **Business** and
   add the **WhatsApp** product.
2. Link it to the WABA from step 1.
3. Create a **System User** in Business Settings → Users → System Users, give it
   the **Admin** role on the WABA, and generate a token with scopes
   `whatsapp_business_messaging` and `whatsapp_business_management`.

> Use a **System User token**, not the temporary token shown in the API Setup
> tab. That one expires after 24 hours and will take verification down with it
> at the worst possible moment.

This token is `WHATSAPP_ACCESS_TOKEN`. It is a bearer credential for the
client's messaging account — store it only in the deployment's secret manager,
never in the repository.

## Step 4 — Create the authentication template

Free-form WhatsApp messages can only be sent inside a 24-hour window after the
customer messages you first. A verification code arrives *before* any such
conversation exists, so it **must** go out as a pre-approved template, and only
the `AUTHENTICATION` category may carry a one-time code.

In WhatsApp Manager → **Message Templates** → Create:

| Field    | Value                                                    |
| -------- | -------------------------------------------------------- |
| Category | **Authentication**                                       |
| Name     | `yourwaves_otp` (lowercase, underscores — no spaces)      |
| Body     | Meta's fixed authentication body with **one** `{{1}}`     |
| Button   | **Copy code**                                            |
| Expiry   | 5 minutes (matches `CODE_TTL_SECONDS` in the code)        |

Add **both** localisations to the same template.

### English (`en`)

```
{{1}} is your verification code. For your security, do not share this code.
```

- Button type: **Copy code**
- Button text: `Copy code` (Meta fixes this string)

### Arabic (`ar`)

```
{{1}} هو رمز التحقق الخاص بك. لأمانك، لا تشارك هذا الرمز مع أي شخص.
```

- Button type: **Copy code**
- Button text: `نسخ الرمز`

Notes that matter:

- The body takes **exactly one parameter**. The code ships it as the sole body
  parameter *and* as the copy-code button's payload — an authentication template
  is rejected at send time if the button parameter is missing.
- Authentication templates are usually approved in **minutes to a few hours**,
  much faster than marketing ones. A rejection is almost always a body that
  deviates from Meta's fixed authentication wording.
- If you rename the template or use different language codes, set
  `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_OTP_TEMPLATE_LANG_AR` and
  `WHATSAPP_OTP_TEMPLATE_LANG_EN` — no code change is needed.

## Step 5 — Add a payment method

WhatsApp Manager → **Billing**. Without one, sends fail with a billing error
even though every other step is correct. Add the billing alert here.

---

## Step 6 — Configure the app

In the deployment environment (and `.env.local` for a local test):

```bash
OTP_CHANNEL=whatsapp
WHATSAPP_PHONE_NUMBER_ID=          # step 2
WHATSAPP_ACCESS_TOKEN=             # step 3, System User token
WHATSAPP_OTP_TEMPLATE_NAME=yourwaves_otp
WHATSAPP_OTP_TEMPLATE_LANG_AR=ar
WHATSAPP_OTP_TEMPLATE_LANG_EN=en

# Signs the 30-minute verification token. Generate with:
#   openssl rand -base64 48
OTP_TOKEN_SECRET=
```

`OTP_CHANNEL` must be `whatsapp` in production — the app **refuses to start the
OTP flow** otherwise, rather than silently logging codes to stdout.

`OTP_TOKEN_SECRET` must be at least 32 characters. Rotating it invalidates all
in-flight verifications, which is the intended behaviour if it is ever exposed.

---

## Verifying it works end to end

```bash
curl -X POST http://localhost:3000/api/otp/send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+974XXXXXXXX","locale":"ar"}'
```

Expect `{"ok":true,"expires_in":300}` and a WhatsApp message within a few
seconds. The response **never** contains the code.

On an iPhone, the code should be offered as a keyboard autofill suggestion above
the OTP boxes — that comes from `autocomplete="one-time-code"` on the first box
plus WhatsApp's copy-code button, and needs no extra configuration.

### If nothing arrives

| Symptom                            | Cause                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| `whatsapp_error_401`               | Token expired (temporary token?) or wrong app            |
| `whatsapp_error_400` + code 132001 | Template name or language code does not exist            |
| `whatsapp_error_400` + code 132000 | Parameter count mismatch — body needs exactly one         |
| `whatsapp_error_403`               | Number not registered, or display name not approved      |
| 200 OK but no message              | Billing not configured, or recipient never opted in       |
| `whatsapp_error_470`               | Outside the allowed window — template category is wrong   |

Server logs record Meta's `code`, `error_subcode` and `fbtrace_id` for every
failure — quote the `fbtrace_id` when contacting Meta support. The code itself
and the access token are never logged.

---

## Local development without any of this

```bash
OTP_CHANNEL=console
OTP_DEV_ECHO=true      # also returns the code in the API response
OTP_TOKEN_SECRET=<any 32+ character string>
```

`OTP_DEV_ECHO` is checked as `=== "true"` **and** `NODE_ENV !== "production"`,
so a production build that inherits the variable still never returns a code.

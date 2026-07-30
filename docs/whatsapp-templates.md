<!-- GENERATED FILE — do not edit by hand.
     Run `pnpm gen:whatsapp-templates` after changing either
     src/lib/notifications/templates/whatsapp-params.json or the
     `notifications` namespace in messages/{ar,en}.json. -->

# WhatsApp message templates — what the client must submit to Meta

Every one of these must exist and be **approved** in the client's WhatsApp
Business account before phase 7 can send anything. Until then
`WHATSAPP_PROVIDER=console` prints the messages instead, and a production
deployment refuses to start with the console transport.

Provisioning the business account, verifying the business and paying for
messages are the **client's responsibility** under the SRS operational notice —
the same boundary as the OTP template in
[whatsapp-setup.md](whatsapp-setup.md) and the payment merchant account in
[payments-setup.md](payments-setup.md).

## Before you start

1. Meta Business Manager → **business verification must be complete**. Template
   creation is gated behind Advanced Access; an unverified business gets
   `(#10) subcode 2388185` when it tries. This blocked the phase-4 OTP
   template too — see whatsapp-setup.md.
2. WhatsApp Manager → **Message templates** → *Create template*.
3. Category **UTILITY** for all of these. They are transactional messages about
   a booking the customer has paid for, not marketing. Submitting them as
   MARKETING invites rejection and costs more per message.
4. Create each template **twice**, once per language, under the same name. Meta
   treats `en` and `ar` as localisations of one template.

## How the parameters work

The bodies below use Meta's positional placeholders. **The numbering is the
contract**: `{{1}}` is filled with whatever the code sends first. The order in
each table is generated from the code that sends it, so as long as the body is
copied verbatim the two cannot disagree.

Do **not** reorder placeholders while translating. Arabic word order often wants
a different sequence than English, but both localisations receive the same
positional array — swapping `{{2}}` and `{{3}}` in the Arabic body puts the
date where the time should be. Rephrase around the order instead.

## Templates

### `yw_booking_confirmed`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 5 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = date, `{{3}}` = time, `{{4}}` = address, `{{5}}` = total |

**English body**

```
Your YourWaves booking is confirmed ✅
Reference: {{1}}
Date: {{2}}
Setup time: {{3}}
Address: {{4}}
Total paid: {{5}}

Our crew arrives about 90 minutes early. Reply here if anything changes.
```

**Arabic body**

```
تم تأكيد حجزك في يورويفز ✅
الرقم المرجعي: {{1}}
التاريخ: {{2}}
وقت التركيب: {{3}}
العنوان: {{4}}
الإجمالي المدفوع: {{5}}

يصل فريقنا قبل الموعد بنحو ٩٠ دقيقة. راسلنا هنا إذا تغيّر أي شيء.
```

### `yw_driver_assignment`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 7 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = arriveBy, `{{3}}` = date, `{{4}}` = customer, `{{5}}` = phone, `{{6}}` = address, `{{7}}` = maps |

**English body**

```
New job: {{1}}
Arrive by: {{2}} on {{3}}
Customer: {{4}} ({{5}})
Address: {{6}}
Map: {{7}}
Reply here if you cannot make it.
```

**Arabic body**

```
مهمة جديدة: {{1}}
الوصول قبل: {{2}} يوم {{3}}
العميل: {{4}} ({{5}})
العنوان: {{6}}
الخريطة: {{7}}
راسلنا هنا إذا تعذّر عليك الحضور.
```

### `yw_assigned`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 4 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = date, `{{3}}` = driver, `{{4}}` = time |

**English body**

```
YourWaves {{1}}: your crew is confirmed for {{2}}. {{3}} arrives about 90 minutes before your {{4}} start.
```

**Arabic body**

```
يورويفز {{1}}: تم تأكيد فريقك ليوم {{2}}. يصل {{3}} قبل موعدك الساعة {{4}} بنحو ٩٠ دقيقة.
```

### `yw_en_route`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 3 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = driver, `{{3}}` = address |

**English body**

```
YourWaves {{1}}: {{2}} is on the way to {{3}} now. Please keep the access route clear.
```

**Arabic body**

```
يورويفز {{1}}: {{2}} في الطريق إلى {{3}} الآن. يرجى إبقاء طريق الوصول خاليًا.
```

### `yw_setup_complete`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 1 |
| **Parameter order** | `{{1}}` = reference |

**English body**

```
YourWaves {{1}}: setup is complete and the safety check is done. Ready when you are 🌊
```

**Arabic body**

```
يورويفز {{1}}: اكتمل التركيب وفحص السلامة. جاهزون متى ما كنت 🌊
```

### `yw_completed`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 1 |
| **Parameter order** | `{{1}}` = reference |

**English body**

```
YourWaves {{1}}: the crew has packed up. Thanks for having us — we'd love to hear how it went!
```

**Arabic body**

```
يورويفز {{1}}: أنهى الفريق التفكيك. شكرًا لاستضافتنا — يسعدنا سماع رأيك!
```

### `yw_cancelled`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 2 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = date |

**English body**

```
YourWaves {{1}}: your booking for {{2}} has been cancelled. Contact us if this was not expected.
```

**Arabic body**

```
يورويفز {{1}}: تم إلغاء حجزك ليوم {{2}}. تواصل معنا إذا لم يكن هذا متوقعًا.
```

### `yw_dispatch_job`

| | |
| --- | --- |
| **Category** | `UTILITY` |
| **Languages** | `en`, `ar` |
| **Body parameters** | 9 |
| **Parameter order** | `{{1}}` = reference, `{{2}}` = date, `{{3}}` = arriveBy, `{{4}}` = customer, `{{5}}` = phone, `{{6}}` = area, `{{7}}` = payment, `{{8}}` = jobLink, `{{9}}` = mapsLink |

**English body**

```
New job {{1}}
{{2}} · arrive by {{3}}
Customer: {{4}} ({{5}})
Area: {{6}}
Payment: {{7}}

Job sheet: {{8}}
Navigate: {{9}}

Open the job sheet for the full address and to update status.
```

**Arabic body**

```
مهمة جديدة {{1}}
{{2}} · الوصول قبل {{3}}
العميل: {{4}} ({{5}})
المنطقة: {{6}}
الدفع: {{7}}

ورقة المهمة: {{8}}
التوجيه: {{9}}

افتح ورقة المهمة لرؤية العنوان الكامل وتحديث الحالة.
```

## After approval

Set in the deployment environment:

```bash
WHATSAPP_PROVIDER=cloud
WHATSAPP_PHONE_NUMBER_ID=...     # same number as the OTP sender
WHATSAPP_ACCESS_TOKEN=...        # a permanent System User token, not a 24h one
```

Then send one real booking through and check the notifications log
(`GET /api/admin/notifications`) shows `sent` for both channels.

## If a send fails

The error is recorded on the row in `last_error` and visible in the log. The
common ones:

| Meta error | Meaning | Fix |
| --- | --- | --- |
| `(#132000)` | Parameter count mismatch | The approved body has a different number of `{{n}}` than the code sends. Regenerate this file and compare. |
| `(#132001)` | Template does not exist | Name or language code differs from the table above. |
| `(#132015)` | Template paused for quality | Too many users blocked or reported it. Meta pauses it automatically; revise the copy. |
| `(#131030)` | Recipient not in allow-list | The number is not on the test allow-list and the account is still in development mode. |
| `(#131047)` | Re-engagement required | Only applies to free-form sends. If this appears, something is bypassing the template path. |

A `4xx` from Meta is treated as **permanent** by the worker: it stops
immediately rather than spending the full retry ladder discovering the template
name is still wrong, and alerts an admin.

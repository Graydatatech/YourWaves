# Phase 10 — performance, SEO, accessibility, RTL

Status of the brief's deliverable, stated first because it is the thing that is
missing.

## The before/after Lighthouse numbers are not in this document

They could not be produced in this session. The machine the phase was worked on
has **no Node.js runtime** — `node`, `npm` and `pnpm` are all absent, and
`node_modules` was never installed — and no `.env.local`, no `DATABASE_URL` and
no local Postgres. That rules out, in one stroke:

| Wanted | Why not |
| --- | --- |
| `pnpm build` | no Node |
| `pnpm check:lighthouse` | Lighthouse is a Node program driving Chrome |
| WebPageTest at a 4G profile | needs a deployed URL; nothing could be built to deploy |
| `pnpm check:a11y`, `pnpm check:layout`, `pnpm check:booking` | puppeteer-core is a Node library |
| `pnpm gen:qa-screenshots` | same |
| `pnpm test` | vitest, and it needs `TEST_DATABASE_URL` |
| `pnpm check:bundle` | reads `.next/`, which requires a build |

Chrome itself is installed, so **every one of those runs as soon as there is a
Node install.** Nothing here is blocked on a decision or a credential — see
[How to produce the numbers](#how-to-produce-the-numbers) at the end.

What follows therefore separates two kinds of claim, and never mixes them:

- **Measured** — arithmetic performed on the source files in this session, and
  reproducible with `pnpm check:contrast`. This covers the whole contrast audit.
- **Reasoned** — a change whose mechanism is understood and whose effect is
  predictable in direction, but whose magnitude is **not** measured here. Every
  performance change below is in this category. None of them should be
  described to anyone as a measured improvement until the table is filled in.

---

## 1. Performance

### 1.1 What was already right

Phase 1 did the expensive part and left notes explaining it. Re-checked and left
alone:

- `next/image` with AVIF-then-WebP, mobile-dense `deviceSizes`, one `priority`
  hero poster and everything else lazy.
- Explicit `aspect-ratio` on every gallery tile, so the masonry column cannot
  reflow when a tile lands late.
- `next/font` self-hosted with **`preload: false`**, which is load-bearing and
  documented in `src/lib/fonts.ts` — see §1.4.
- No `background-attachment: fixed`, no large `blur()` on animated elements.
- `NextIntlClientProvider` narrowed to `CLIENT_NAMESPACES` so the catalogue does
  not ship to the browser.
- `Cache-Control` on `/api/availability` (30s + 300s SWR) and `/api/settings`
  (60s + 120s SWR), both with the reasoning for the window written down.
- The marketing page is already statically generated: `generateStaticParams` +
  `setRequestLocale`, no database read on the render path.

The brief asked for cache headers and static generation for the marketing page.
Both already existed; nothing was changed.

### 1.2 Shipping less JavaScript

**The booking wizard is now a separate chunk.**
`src/components/booking/BookingFlowLazy.tsx` holds it back until either an
`IntersectionObserver` with 800px of `rootMargin` says the section is
approaching, or `requestIdleCallback` says the main thread is free — whichever
fires first. 800px is about one phone screen of warning, so on an ordinary
scroll the chunk is fetched and parsed before the section is visible. The idle
trigger covers the paths the observer cannot see: a `#booking` deep link, the
header CTA, and Safari's late-firing observer on a long page.

This is the single biggest client component on the page — provider, calendar,
time picker, location step, OTP field, hold countdown, checkout hook — and none
of it is needed to render, read or scroll the page above it.

`BookingSection` imports the wrapper **from its module, not from
`@/components/booking`**, because the barrel also exports `BookingFlow` itself
and a tree-shake away from undoing the split is too close for comfort.

**The map picker is a separate chunk too.** The Google Maps *SDK* was already
lazy (`src/lib/booking/googleMaps.ts`), but `MapPicker`'s own code and the
`Sheet` primitive it mounts were statically imported into the booking bundle for
every visitor — including the majority who type an address and never open a map.
It is now `next/dynamic` with `ssr: false`, and it is only put into the tree
after the first tap: `next/dynamic` fetches when a component *enters the tree*,
not when it becomes visible, so rendering it with `open={false}` would have
defeated the split entirely.

**Admin was left alone, deliberately.** The brief asks to code-split the admin
dashboard, but the App Router already splits per route, and every heavy admin
view is the whole route. Splitting further only pays where a component is
conditionally rendered — which is what the map picker is and the admin views are
not. Doing it anyway would add indirection for no measurable gain, and there is
no measurement available here to justify it either way.

### 1.3 Images

Every marketing image is now imported **as a module** rather than referenced by
path:

```ts
import heroPoster from "../../../public/media/hero-poster.jpg";
```

Three things follow, none of which was available with a string `src`:

- **`placeholder="blur"` actually works.** With a string `src` the prop is
  silently ignored unless you hand-write the base64. The blur is ~1KB inlined
  into the HTML, so the hero paints a colour in the same frame as the document,
  and the six lazy gallery tiles stop reading as grey holes on 4G. Chrome's
  low-entropy heuristic excludes blur placeholders from LCP candidacy, so this
  cannot flatter the metric.
- **Intrinsic dimensions come from the file**, so the reserved box is the real
  one.
- **The URL is content-hashed**, which is what makes the one-year
  `minimumCacheTTL` added to `next.config.ts` safe: a new file is a new URL.

`public/` is outside the `@/*` alias root, so these imports are relative by
necessity — the one place in the codebase where that is correct.

### 1.4 Fonts

**Two weights were being downloaded and resolved by nothing.** A census of the
weight utilities actually present in `src/`:

```
143  font-bold        (700)
 98  font-semibold    (600)
 30  font-extrabold   (800)
  0  font-medium      (500)
```

Cross-referenced against which family each lands on:

- **Sora 600 removed.** Sora is only reachable through `--font-display`: `h1`–
  `h4`, `.text-display`, `.text-h2`, and the `.font-display` utility. Every one
  of those resolves to 700 or 800 — `font-semibold` never lands on a heading. A
  whole file, downloaded on every English page, for nothing.
- **IBM Plex Sans Arabic 500 removed.** There is no `font-medium` anywhere in
  the project. This one was worse: Arabic is the default locale, and the family
  is declared with both the `arabic` and `latin` subsets, so it was two files on
  the critical path of the page most visitors see.

The reasoning is written into `src/lib/fonts.ts` along with the one-line command
to re-run the census, because the failure mode is somebody adding a weight
"to be safe".

**Preloading was left off**, against the letter of the brief and for a stated
reason. The brief asks to preload the two faces above the fold. `preload` in
`next/font` is per-*family*, and all three families are declared in one module
for every route because the locale is not known until `[locale]/layout.tsx`
renders — so there is no way to express "just this one" through that API.
Hand-writing the `<link rel="preload">` in the layout is possible, but it would
trade phase 1's **measured** win (244KB of fonts starving an 11KB hero image,
LCP 4.4s) for an unmeasured guess, in a session with no way to measure. The
preloaded face would still be competing with the LCP image for the same 4G
bandwidth, and `display: swap` plus next/font's metric-matched fallback already
closes the invisible-text window preloading exists to close. **This is the one
item in the brief that was consciously not done.** Revisit it with a trace.

Glyph-level subsetting beyond next/font's unicode-range subsets was not
attempted: it needs `fonttools`, and a hand-subset font breaks the moment
someone adds copy containing a glyph the subset dropped.

### 1.5 CLS

Every media element on the customer-facing pages carries an explicit box:

| Element | How the box is reserved |
| --- | --- |
| Hero poster | `fill` inside `absolute inset-0` on a `min-h-[min(92vh,860px)]` section |
| Gallery tiles (6) | per-tile `style={{ aspectRatio }}`, declared not measured |
| Safety/specs image | `aspect-[4/3]` on mobile, `lg:min-h-[340px]` above |
| Hero video | only ever mounted over the poster's own box, faded in on `canplaythrough` |
| Booking wizard | skeleton reserves the box before the lazy chunk lands |

The aspect ratios are still written by hand even though the static imports now
carry the files' real dimensions, because the ratio is a *design* decision — the
tile is cropped to that shape — and the placeholder art will be replaced by
photography of different proportions.

**CLS is not measured.** The target is < 0.05; the structural preconditions are
in place, and `pnpm check:lighthouse` reports the number.

### 1.6 `next.config.ts`

- `poweredByHeader: false`.
- `images.minimumCacheTTL: 31_536_000` — safe because of §1.3's content hashing.
- `Cache-Control: public, max-age=604800` on `/media/*` for the direct-path
  references that remain (OG fallback, email imagery). A week, not a year: these
  paths are *not* content-hashed and the placeholders will be replaced in place.
- `X-Robots-Tag: noindex, nofollow, noarchive` + `Cache-Control: no-store` +
  `Referrer-Policy: no-referrer` on `/d/*`, and `noindex` + `no-store` on
  `/admin/*`. The `/d` layout already sets the meta tags; this sets the header
  that CDNs and crawlers actually honour.
- `images.qualities` and `images.remotePatterns` were deliberately **not** set —
  `qualities` is a Next-16-specific key that could not be validated against the
  installed version from this machine, and nothing overrides the default quality
  anyway. The reasoning is recorded in the file so it reads as a decision.

### 1.7 The bundle budget

`pnpm check:bundle`, backed by `scripts/check-bundle.mjs`. It reads
`.next/app-build-manifest.json` and `.next/build-manifest.json`, sums the
**gzipped** first-load JS for three routes, and fails over budget:

| Route | Why it is policed |
| --- | --- |
| `/[locale]/page` | the 4G villa page; every visitor pays it before anything works |
| `/[locale]/booking/success/[reference]` | loaded straight after payment, often on a worse connection |
| `/d/[token]` | a driver, in a car, in a villa driveway |

Gzipped rather than raw, because a raw byte count rewards the wrong changes: a
hundred repetitive class names cost almost nothing on the wire, while one small
library with a distinct vocabulary costs a lot.

It is a **ratchet, not a target**. `bundle-budget.json` holds the committed
per-route baseline; `pnpm check:bundle:update` rewrites it, and the increase
shows up in a diff where it can be argued about. Tolerance is 2%, enough to
absorb a dependency patch bump and not enough to hide a regression. A route that
disappears from the manifest is a **failure**, not a silent skip — an unmeasured
route is how a budget stops covering the thing it was written for.

**`bundle-budget.json` does not exist yet.** It cannot: writing it requires a
build. The first `pnpm check:bundle:update` after a successful build creates it,
and until then every route is checked against a 200KB default. Wired into
`pnpm ci` (`verify && build && check:bundle`).

---

## 2. SEO

Essentially none of this existed before; the site had a title, a description and
one hardcoded OG image path.

- **`src/lib/seo.ts`** is the single source of the origin, the canonical URL and
  the hreflang cluster, so the `<head>`, the sitemap and the JSON-LD cannot
  disagree. Two things it gets right that are commonly got wrong: the canonical
  for `/en` is `/en` and not `/ar` (pointing it at the default locale tells
  Google the English page is a duplicate not to index), and **`x-default` is the
  Arabic page** — the default locale, in a Qatari business — not the reflexive
  English one.
- **OpenGraph locales are `ar_QA` / `en_QA`**, not bare language codes.
  WhatsApp and Facebook ignore `ar`. Given how this site's links will actually
  be shared, that is not pedantry.
- **`opengraph-image.tsx`**, one generated card per locale, statically rendered
  at build. Typographic on the brand gradient rather than a crop of the
  placeholder art, because it is read at thumbnail size.
  - Satori has **no system fonts** and throws rather than falling back, and a
    throw in a metadata route at build time is a failed deploy. So the route
    reads a face from `public/fonts/` and, if it is not there, returns a
    **text-free** card — gradient and logo dot — instead of failing.
    `pnpm gen:og-fonts` populates the directory; commit the two files. A build
    that reaches out to Google Fonts is a build that fails when Google Fonts is
    slow.
  - Satori has no bidi algorithm, so the RTL card expresses direction through
    `flexDirection` and `textAlign`, and the copy is kept to whole phrases with
    no inline numbers — there is nothing in there to isolate a mixed run with.
- **`twitter: { card: "summary_large_image" }`**. `summary` crops 1200×630 to a
  square and loses the wordmark.
- **JSON-LD** (`src/lib/jsonLd.ts`), one `@graph`: `LocalBusiness` with
  `areaServed`, `Service`, `FAQPage` and `WebSite`. Built from the same `t()`
  calls the page renders, never a parallel copy — a hand-maintained duplicate of
  the FAQ answers drifts on the first wording change, and structured data that
  contradicts the page is a manual-action risk. Two deliberate omissions,
  both explained in the file: no `PostalAddress` (there is no customer-facing
  premises, and inventing one puts a lie in a machine-readable format) and no
  `offers` price (pricing is changed from the back office without a deploy, so a
  baked-in number goes stale silently and gets quoted back at us).
- **`sitemap.ts`** at the app root, both locales, each entry carrying its own
  `alternates.languages`. `lastModified` is a fixed date, not `new Date()`:
  wiring it to build time tells a crawler the page changed every time anything
  in the repo did, which trains it to stop believing the field.
- **`robots.ts`** disallows `/api/`, `/admin`, `/d/`, `/dev/`, `/*/booking/` and
  `/*/styleguide`, and omits the sitemap URL entirely when
  `NEXT_PUBLIC_SITE_URL` is unset rather than pointing a crawler at localhost.
- **`[locale]/layout.tsx` now defaults to `robots: { index: false }`**, with the
  marketing page opting in explicitly. That makes the booking success and
  failure pages — which are keyed by reference and name a real customer's
  order — noindex by default rather than by remembering.

### Error pages, both languages

| File | Covers |
| --- | --- |
| `[locale]/not-found.tsx` | a mistyped path under `/ar` or `/en` — translated properly |
| `[locale]/error.tsx` | a render error inside a locale segment |
| `not-found.tsx` (root) | a URL that resolved no locale — now **bilingual** |
| `global-error.tsx` | a root-layout failure — bilingual, renders its own document |

Two decisions worth keeping:

**The error boundaries do not read the message catalogue.** Copy is inline. An
error boundary has to work in exactly the situation where the rest of the app
did not, and `messages/*.json` is part of the rest of the app — a malformed
catalogue or a failed dynamic import of the locale file renders these
components, and a version calling `useTranslations` would throw
`MISSING_MESSAGE` on top of the original error and turn a recoverable page
blank. It also keeps those strings out of `CLIENT_NAMESPACES`, which every
visitor pays for.

**The locale-less pages say it in both languages,** each half carrying its own
`lang`/`dir` so a screen reader switches pronunciation between them (WCAG
3.1.2). The root 404 was Arabic-only on the grounds that Arabic is the default
locale, but that does not survive contact with who lands there: they followed a
link that does not work, so we know nothing about them — not even the language
preference a working URL would have carried. The old root 404 also never applied
`fontVariables`, so it rendered in the browser's default serif; fixed.

---

## 3. Accessibility

### 3.1 The contrast audit — this part IS measured

**This is the real finding of the phase, and it is bigger than the brief's
framing.**

The brief flagged `#5f7c8e` and `#64808f` as borderline. `#64808f` does not
appear in the codebase at all. But the audit that produced those numbers — and
the one recorded in CLAUDE.md §3 — was run **against white**, and most text on
this site does not sit on white. `<html>` carries `--page-background`: a linear
gradient bottoming out at `#e1edf4` with a radial peaking at `#d3ecf6`. Against
the background actually painted behind it:

| Token | on white | on `#e1edf4` | on `#d3ecf6` | verdict |
| --- | --- | --- | --- | --- |
| `--muted` `#4a6577` | 6.14 | 5.15 | 5.00 | passed |
| `--muted-2` `#587488` | 4.92 | **4.13** | **4.01** | **failed AA** |
| `--muted-3` `#5f7c8e` | **4.41** | **3.70** | **3.59** | **failed AA** |
| `--accent-strong` `#0a7a8c` | 5.03 | **4.22** | **4.10** | **failed AA** |
| `text-red-600` `#dc2626` | 4.83 | **4.05** | **3.93** | **failed AA** |

`--accent-strong` is the one that matters most: it exists *specifically* as the
AA-safe variant of `--accent`, documented in CLAUDE.md as "5.03:1, use this for
small copy" — and on the surface it is used on, it failed. `red-600` was worse
in kind: form error messages are the copy a user most needs to read, and they
failed AA exactly where they appear.

**What changed.** The ramp was re-solved against `#e1edf4` and verified against
`#d3ecf6`:

| Token | Before | After | white | `#e9f3f8` | `#e1edf4` | `#d3ecf6` |
| --- | --- | --- | --- | --- | --- | --- |
| `--muted` | `#4a6577` | **`#425a6b`** | 7.23 | 6.41 | 6.06 | 5.88 |
| `--muted-2` | `#587488` | **`#4c6475`** | 6.20 | 5.50 | 5.20 | 5.05 |
| `--muted-3` | `#5f7c8e` | **`#516a7a`** | 5.69 | 5.05 | 4.77 | 4.63 |
| `--accent-strong` | `#0a7a8c` | **`#097182`** | 5.68 | 5.04 | 4.77 | 4.63 |
| `--danger` (new) | `red-600 #dc2626` | **`#c82020`** | 5.70 | 5.06 | 4.78 | 4.64 |

Hue and saturation are preserved; only lightness moved. `--accent` itself is
**unchanged** — it is the brand colour and remains correct for icons, fills,
borders and large text, where it is held to 3:1.

Two notes on the numbers. First, the bottom of the ramp deliberately sits a
little *above* 4.5 rather than on it: an earlier pass solved `--muted-3` to
exactly 4.50 and the check failed on floating-point rounding. A token that needs
the audit to round in its favour is not one to ship. Second, the three-step
muted ramp survives but is compressed — on this background there is not room for
three widely-spaced greys above AA, and the steps are now closer together than
the original design intended.

**A `--danger` token replaced `text-red-600`** across nine files, plus
`--danger-surface` for the tint behind an error. Fifteen call sites; the ad-hoc
Tailwind reds are gone from the customer flow.

**The email palette had the same bug for the same reason.**
`templates/theme.ts` duplicates the tokens as literal hex (the one file allowed
to, since `var()` cannot resolve in Outlook), and email text does not sit on
white either — it sits on `page` `#eef5f9`, `panel` `#f3f9fc`, and inside the
alert boxes on `dangerBg` and `warningBg`. Old `muted2` was 4.47 on `page` and
4.30 on `dangerBg`; old `accentStrong` 4.57 and 4.40. Updated to match the site
ramp, which also stops a payment confirmation from looking like it came from a
slightly different brand than the page that produced it. One bullet glyph moved
from `accent` to `accentStrong` — it is a 15px text character, so it is held to
4.5:1, not 3:1.

The `/d/[token]` job sheet's inline hex was updated too. It is read outdoors in
Qatari sunlight, which is the least forgiving contrast environment on the
project.

**The admin status pills were failing for a third reason: nothing was auditing
them at all.** They are literal hex in Tailwind arbitrary values rather than
tokens — legitimately, because a dense ops screen wants a flatter palette than
the marketing site — so each pill is a text colour on its own tint that occurs
nowhere else. `expired` was `#64748b` on `#f1f5f9`, **4.34:1**, a plain AA
failure that had survived phase 8 and every audit since. `confirmed` was still
on the pre-phase-10 accent and scraped 4.55:1. Both fixed, and
`check:contrast` now **parses the `TONE` map out of `StatusPill.tsx`** so the
eight pills are checked from source rather than from a copy that would go stale.

**76 colour pairs are now checked by `pnpm check:contrast`, and all 76 pass.**
It parses the hex straight out of `globals.css` and `theme.ts`, so it cannot
pass while the tokens say something else, and it runs in the pre-commit hook
because it needs no build, no browser and no database.

### 3.2 Focus rings

The brief says the mockup has none. The code did — a global `:focus-visible`
rule was already there. What it did not have was a ring that works on the dark
sections:

| Surface | `--accent` (was) | `--accent-strong` | `--accent-light` |
| --- | --- | --- | --- |
| page gradient | 3.22 | **4.77** | 1.12 |
| page radial peak | 3.12 | **4.63** | 1.08 |
| white card | 3.84 | **5.68** | 1.33 |
| footer `#04202f` | 4.37 | 2.95 | **12.60** |
| dark panel `#0a2c46` | 3.74 | 2.53 | **10.80** |
| hero scrim | 4.91 | 3.32 | **14.18** |

`--accent` cleared 3:1 everywhere, so this is not a fix for a failure — it is a
fix for a ring that was only just visible on the surface most of the page is
made of. 3.12:1 is a hairline. The ring now reads from `--focus-ring`, which
defaults to `--accent-strong` and is overridden to `--accent-light` by an
`.on-dark` class on the hero and the footer. Ten components that set their own
`focus-visible:outline-accent` (because they need a specific `outline-offset`)
were switched to a new `outline-focus` utility that resolves through the same
variable, so those overrides flip on a dark surface instead of pinning
themselves to a colour that fails there.

No `box-shadow` halo: it would clobber `shadow-cta` on the primary CTA while
focused, and `outline-offset` already paints the ring on the section background
rather than the control's fill, which is what makes one colour per section
enough.

### 3.3 Semantics — audited, largely already correct

The booking flow was built carefully in phases 3–5 and this pass mostly
confirmed it. Verified by reading, not by running:

- Calendar: `role="grid"` + roving tabindex (one tabbable cell), `aria-disabled`
  rather than `disabled` on unavailable days so a screen-reader user is *told*
  the 14th is booked, arrow keys mirrored in RTL, cell labels carrying both the
  full date and the availability state, and a neutral "pending" state while
  availability is in flight.
- OTP field: `role="alert"` + `aria-live` on the status line, error state
  announced.
- Wizard progress: an `<ol>` with `aria-current="step"`.
- FAQ: native `<details>`/`<summary>`, no hand-written `aria-expanded` to go
  stale.
- Skip link is the first focusable element.

One real bug found and fixed: **`src/app/d/layout.tsx` had no `lang` and no
`dir` on `<html>`** — a flat WCAG 3.1.1 failure, and the kind that makes a
screen reader read Arabic with an English pronunciation model. It now declares
`lang="en" dir="ltr"` as the document default, with the page's `<main>`
overriding per recipient (WCAG 3.1.2, Language of Parts). A layout cannot read
search params, so it cannot know the recipient's language; this is the correct
shape rather than a compromise.

The lazy booking wrapper announces itself: a `role="status"` line saying the
form is loading, so a deep link into `#booking` does not land on three silent
grey bars.

`prefers-reduced-motion` was already honoured globally, including `.motion-decoration`
being switched off entirely rather than merely sped up. `pnpm check:a11y` now
asserts it by emulating the media feature and looking for surviving animations.

### 3.4 `pnpm check:a11y`

New. Asserts, in a real browser, both locales, at 390px: document `lang`/`dir`;
an accessible name on every interactive element; a visible focus indicator
(measured by focusing each element and diffing computed style, not by trusting
that a rule exists); exactly one tabbable calendar cell; one `<h1>` and no
skipped heading levels; a label on every form control; `alt` on every image; the
skip link genuinely first; and no surviving animation under
`prefers-reduced-motion`.

It scrolls to `#booking` and waits for real availability first, so it audits the
wizard rather than its skeleton.

**What it cannot do, and which still needs a person:** judge whether an
accessible name is any *good* (`"button"` passes), reproduce VoiceOver's
announcement order and phrasing, or check text over the hero photograph. **The
VoiceOver-on-iOS pass in the brief has not been done** and cannot be automated.

---

## 4. RTL

### 4.1 Audited and already correct

The RTL discipline in this codebase is genuinely good, and most of the walk
found nothing to change. Recorded so the next session does not redo it:

- **No physical-direction classes anywhere** — the custom lint rule enforces it
  across every string literal, not just JSX `className`.
- **Chevron direction.** Every horizontally-asymmetric SVG path in the project
  was enumerated. The two inline-pointing chevrons (calendar prev/next) carry
  `rtl:rotate-180`. Everything else is either vertical (accordion, select),
  symmetric (plus, close, crosshair), or a symbol that must **not** mirror: the
  checkmarks, the WhatsApp mark, the five-star rating, and the clock hand — a
  clock runs clockwise in every language.
- **No hardcoded directional glyphs** (`→`, `←`) in customer-facing code. The
  ones that exist are all in `/admin`, which is English-only LTR by design.
- **Shadows** are vertical-offset only (`0 12px 34px`), so they do not assume a
  light direction.
- **`<Bidi>` coverage** is thorough — every price, date, time, reference, phone
  number and spec value in the booking flow, hero and footer.
- The calendar grid mirrors for free via CSS grid's inline direction; the
  progress indicator is a logical flex row; the nav panel's slide-in uses a
  `--slide-from` custom property that flips on `[dir]`.
- Email templates set `dir` on the document *and* each block (forwarding drops
  the outer element) and resolve `start`/`end` to `left`/`right` explicitly,
  because logical properties do not exist in Outlook's Word engine.

### 4.2 Fixed

**Two instances of the exact bug CLAUDE.md §4 warns about**, both on the
dispatch job sheet, both `dir="ltr"` where `dir="auto"` is correct:

- The arrival time — the largest number on the page, the one a driver reads at a
  glance. `formatTime` pins Latin *digits* but leaves the meridiem in the
  locale's script, so the Arabic string is `8:00 ص`: its first strong character
  is Arabic and the run is therefore RTL. Forcing LTR moved the `ص` to the wrong
  end. Same class of failure as the "km/h 45" hero.
- The price, for the same reason — `formatMoney` renders the currency as
  `ر.ق.` in Arabic. This is the figure a driver may be collecting in cash.

A third, related: `{startTime}: {formatTime(…)}` sits *inside* a sentence with
no isolation, leaving the colon as a neutral character between an Arabic label
and a digit-leading time, free to be reordered. Now isolated.

The booking reference keeps `dir="ltr"` — it is pure Latin, which is exactly the
case the CLAUDE.md table says `ltr` is right for.

**Direction-dependent light.** `background-image` has no logical form: a
gradient is described in physical coordinates and stays put when the document
mirrors. Everything else on the page flips, so the light source ended up on the
side an Arabic reader's eye *leaves* from — which is specifically the thing that
makes a translated site feel translated. The page glow (`--glow-x`, 82% → 18%)
and the dark panel's hatch (`--hatch-angle`, 135deg → 45deg) now mirror.

`--brand-gradient` is deliberately **not** mirrored: it fills pills, CTAs and
the wordmark, and it is an identity asset — a logo is not flipped between
languages. `--summary-gradient` is left alone too; at 160deg between two
near-identical tints there is nothing to see.

### 4.3 Screenshots — NOT captured

`docs/qa-screenshots/` is empty. `pnpm gen:qa-screenshots` is written and ready:
eleven screens × two locales × 390/768/1440, pairing the locales at matching
widths and writing a `README.md` index so the folder is reviewable as a table
rather than a pile of PNGs. It drives the wizard (the later steps are not
reachable by URL) via two new `data-testid` hooks, and includes the `/d/[token]`
job sheet when a `DISPATCH_TOKEN` is supplied.

It needs a **production** build, not the dev server: under headless Chrome the
dev server's failing HMR socket leaves the page unhydrated and every interactive
component inert — the phase-9 trap, recorded in CLAUDE.md.

The RTL walk itself was done by reading source across every screen. That found
the three bidi bugs and the missing `lang`/`dir` above. It cannot find the class
of problem the screenshots exist for — something that is valid, correctly
measured, and simply looks wrong to an Arabic reader.

---

## How to produce the numbers

```bash
# 0. A Node 20+ toolchain must exist. Nothing below works without it.
corepack enable && corepack prepare pnpm@latest --activate
pnpm install

# 1. Static checks — no build, no browser, no database.
pnpm check:contrast          # 76 pairs; should be green already
pnpm lint && pnpm typecheck  # typecheck needs next-env.d.ts, which a build writes

# 2. Build, then baseline the bundle budget.
pnpm build
pnpm check:bundle:update     # writes bundle-budget.json — commit it
pnpm check:bundle

# 3. Browser passes. Production build, NOT the dev server.
pnpm start &
pnpm check:lighthouse                  # simulated 4G
THROTTLING=devtools pnpm check:lighthouse
pnpm check:a11y
pnpm check:layout
pnpm gen:qa-screenshots

# 4. The OG card's fonts (optional; the route degrades without them).
pnpm gen:og-fonts            # writes public/fonts/ — commit the two files
```

Then fill in the table below and delete this paragraph.

| Metric | Before (pre-phase-10) | After | Target |
| --- | --- | --- | --- |
| Performance (mobile, `/ar`) | — | — | ≥ 90 |
| Performance (mobile, `/en`) | — | — | ≥ 90 |
| LCP | — | — | < 2.0s |
| CLS | — | — | < 0.05 |
| TBT | — | — | — |
| First-load JS, `/[locale]` | — | — | ratchet |
| Accessibility | — | — | ≥ 95 |
| SEO | — | — | 100 |

To get a genuine **before**, check out `f26d30b` into a worktree, build it, and
run `pnpm check:lighthouse` against that. The after-numbers are worth little
without it — the phase-1 notes are the only recorded baseline and they predate
three phases of feature work.

WebPageTest needs a deployed URL and an API key, neither of which exists yet;
Lighthouse's `THROTTLING=devtools` mode applies real throttling to the actual
load and is the closest local substitute.

---

## Carried forward

- **The `before` column is empty and the `after` column is empty.** Everything
  in §1 is reasoned, not measured. Do not quote any of it as an improvement
  until §"How to produce the numbers" has been run.
- **Font preloading was not implemented** — §1.4 explains why, and it is the one
  item in the brief consciously left undone.
- **No VoiceOver pass.** It needs a real iOS device and cannot be automated.
- **`docs/qa-screenshots/` is empty**; the generator is written.
- **`bundle-budget.json` does not exist**; it needs one successful build.
- **`public/fonts/` is empty**, so the OG card currently renders in its
  text-free fallback form. `pnpm gen:og-fonts` fixes it.
- **`NEXT_PUBLIC_SITE_URL` is unset.** Until it is, canonicals resolve to
  localhost and `robots.txt` correctly omits the sitemap line. Nothing in §2 is
  live without it.
- The muted ramp is now compressed — three steps between 5.69 and 7.23 on white,
  where the original design had 4.41 to 6.14. If the design wants more visible
  separation between the muted levels, the lever is the page background, not the
  greys: lightening `--page-background`'s darkest stop gives the whole ramp
  headroom back.

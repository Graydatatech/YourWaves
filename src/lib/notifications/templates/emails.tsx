import type { ReactElement } from "react";
import {
  Block,
  BulletList,
  Callout,
  DetailTable,
  EmailBody,
  EmailButton,
  EmailFooter,
  EmailHeader,
  EmailShell,
  Heading,
  Paragraph,
  ReferenceBadge,
  type DetailRow,
} from "./components";
import { email } from "./theme";
import type { TemplateContext } from "./context";

/**
 * The email bodies. One exported function per template key.
 *
 * Each takes the prepared TemplateContext and returns a complete document, so
 * they can be rendered by the worker, by the preview route and by a test with
 * no difference in behaviour.
 */

function Frame({
  ctx,
  preheader,
  children,
}: {
  ctx: TemplateContext;
  preheader: string;
  children: ReactElement | ReactElement[];
}) {
  const { t, dir, locale } = ctx;
  return (
    <EmailShell
      dir={dir}
      locale={locale}
      preheader={preheader}
      footer={
        <EmailFooter
          dir={dir}
          lines={[
            t("common.rights", { year: new Date().getFullYear() }),
            t("common.automated"),
          ]}
        />
      }
    >
      <EmailHeader dir={dir} brand={t("common.brand")} />
      <EmailBody dir={dir}>{children}</EmailBody>
    </EmailShell>
  );
}

/** The label/value rows every customer-facing email repeats. */
function bookingRows(ctx: TemplateContext): DetailRow[] {
  const { t } = ctx;
  return [
    { label: t("common.date"), value: ctx.dateLong, isolate: true },
    { label: t("common.time"), value: ctx.startTime, isolate: true },
    { label: t("common.address"), value: ctx.addressFull },
  ];
}

function ContactBlock({ ctx }: { ctx: TemplateContext }) {
  const { t, dir } = ctx;
  return (
    <>
      <Block dir={dir} paddingTop={22}>
        <Paragraph dir={dir} small muted>
          <strong style={{ color: email.ink }}>
            {t("common.contactTitle")}
          </strong>{" "}
          {t("common.contactBody", { phone: ctx.supportPhone })}
        </Paragraph>
      </Block>
      <Block dir={dir} paddingTop={4}>
        <EmailButton href={ctx.whatsappLink} variant="whatsapp">
          WhatsApp
        </EmailButton>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------------------
// SRS 3.4.1 — order received (customer)
// ---------------------------------------------------------------------------

export function BookingConfirmedEmail(ctx: TemplateContext): ReactElement {
  // `payload` is no longer read here: the per-line prices it carried are not
  // shown, and the total comes pre-formatted on the context. The local `money`
  // helper and the `currency` it closed over went with them.
  const { t, dir } = ctx;

  return (
    <Frame ctx={ctx} preheader={t("bookingConfirmed.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("bookingConfirmed.heading")}</Heading>
        <Paragraph dir={dir} muted>
          {t("bookingConfirmed.intro", { name: ctx.customerName })}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <ReferenceBadge label={t("common.reference")} value={ctx.reference} />
      </Block>

      <Block dir={dir} paddingTop={20}>
        <DetailTable dir={dir} rows={bookingRows(ctx)} />
      </Block>

      {/*
        ONE PRICE, not a breakdown.

        The original invoice-style table listed rental, setup and delivery
        before the total. Migration 0012 folded all three into a single day
        rate and writes setup and delivery as zero, so two of those lines had
        become "QAR 0" on every new booking — an itemisation that makes the
        business look like it is charging for things it is not, and invites
        the question of what the zeroes mean.

        The columns still exist and a booking taken before 0012 still holds
        real values in them, which is why nothing was deleted from the
        payload. It is simply not shown.
      */}
      <Block dir={dir} paddingTop={20}>
        <DetailTable
          dir={dir}
          rows={[
            {
              label: t("price.total"),
              value: ctx.total,
              isolate: true,
              strong: true,
            },
          ]}
        />
      </Block>

      <Block dir={dir} paddingTop={22}>
        <BulletList
          dir={dir}
          title={t("prep.title")}
          items={[
            t("prep.space"),
            t("prep.power"),
            t("prep.water"),
            t("prep.arrival"),
            t("prep.swimwear"),
          ]}
        />
      </Block>

      <ContactBlock ctx={ctx} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// SRS 3.4.2 — new booking alert (admin)
// ---------------------------------------------------------------------------

export function AdminBookingConfirmedEmail(ctx: TemplateContext): ReactElement {
  const { t, dir, payload } = ctx;

  return (
    <Frame ctx={ctx} preheader={t("adminBookingConfirmed.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("adminBookingConfirmed.heading")}</Heading>
        <Paragraph dir={dir} muted>
          {t("adminBookingConfirmed.intro")}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <ReferenceBadge label={t("common.reference")} value={ctx.reference} />
      </Block>

      <Block dir={dir} paddingTop={20}>
        <DetailTable
          dir={dir}
          rows={[
            { label: t("common.customer"), value: ctx.customerName },
            {
              label: t("common.phone"),
              value: ctx.customerPhone,
              isolate: true,
            },
            { label: t("common.date"), value: ctx.dateLong, isolate: true },
            { label: t("common.time"), value: ctx.startTime, isolate: true },
            { label: t("common.address"), value: ctx.addressFull },
            { label: t("common.area"), value: payload.area ?? "" },
            {
              label: t("common.total"),
              value: ctx.total,
              isolate: true,
              strong: true,
            },
          ]}
        />
      </Block>

      {payload.notes ? (
        <Block dir={dir} paddingTop={18}>
          <Callout dir={dir} tone="warning">
            <strong>{t("adminBookingConfirmed.notes")}:</strong> {payload.notes}
          </Callout>
        </Block>
      ) : (
        <></>
      )}

      {/* The point of this email. Assigning a driver is the only action the
          booking needs, so it is the only button. */}
      <Block dir={dir} paddingTop={22}>
        <EmailButton href={ctx.adminLink}>
          {t("adminBookingConfirmed.cta")}
        </EmailButton>
      </Block>
      <Block dir={dir} paddingTop={8}>
        <Paragraph dir={dir} small muted>
          {t("adminBookingConfirmed.ctaHint")}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={10}>
        <EmailButton href={ctx.mapsLink} variant="outline">
          {t("common.openInMaps")}
        </EmailButton>
      </Block>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// SRS 3.4.3 — driver assignment
//
// The SRS names exactly four required fields: customer phone, address, maps
// link and required arrival time. They are the first thing in the email, above
// everything else, because this is read one-handed in a van.
// ---------------------------------------------------------------------------

export function DriverAssignmentEmail(ctx: TemplateContext): ReactElement {
  const { t, dir, payload } = ctx;

  return (
    <Frame ctx={ctx} preheader={t("driverAssignment.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("driverAssignment.heading")}</Heading>
        <Paragraph dir={dir} muted>
          {t("driverAssignment.intro")}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <ReferenceBadge
          label={t("driverAssignment.arriveBy")}
          value={`${ctx.arrivalTime} · ${ctx.dateLong}`}
        />
      </Block>
      <Block dir={dir} paddingTop={8}>
        <Paragraph dir={dir} small muted>
          {t("driverAssignment.arriveByHint", { start: ctx.startTime })}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={14}>
        <DetailTable
          dir={dir}
          rows={[
            {
              label: t("common.reference"),
              value: ctx.reference,
              isolate: true,
            },
            { label: t("common.customer"), value: ctx.customerName },
            {
              label: t("common.phone"),
              value: ctx.customerPhone,
              isolate: true,
              strong: true,
            },
            { label: t("common.address"), value: ctx.addressFull },
            { label: t("common.area"), value: payload.area ?? "" },
          ]}
        />
      </Block>

      <Block dir={dir} paddingTop={22}>
        <EmailButton href={ctx.mapsLink}>{t("common.openInMaps")}</EmailButton>
      </Block>

      <Block dir={dir} paddingTop={10}>
        <EmailButton
          href={`tel:${ctx.customerPhone.replace(/\s/g, "")}`}
          variant="outline"
        >
          {t("driverAssignment.callCustomer")}
        </EmailButton>
      </Block>

      {payload.notes ? (
        <Block dir={dir} paddingTop={18}>
          <Callout dir={dir} tone="warning">
            {payload.notes}
          </Callout>
        </Block>
      ) : (
        <></>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// SRS 3.4.4 — lifecycle status updates (customer)
// ---------------------------------------------------------------------------

export type StatusKey =
  "assigned" | "en_route" | "setup_complete" | "completed" | "cancelled";

export function StatusUpdateEmail(
  ctx: TemplateContext,
  status: StatusKey,
): ReactElement {
  const { t, dir } = ctx;

  /**
   * The completion email carries the review link (0019).
   *
   * It already ended "we would love to hear how it went" and then did not say
   * how — the ask and the means were in two different emails, the second
   * arriving a day later. One email, one button.
   *
   * Guarded on the token rather than on the status alone: a booking with no
   * email address is never minted one, and rendering a button to /r/ with
   * nothing after it would be worse than leaving the sentence unanswered.
   */
  const surveyHref = status === "completed" ? reviewHref(ctx.payload) : null;

  // A named crew member reads far better than "your driver", but the driver may
  // not be assigned yet for some transitions, so fall back rather than render
  // an empty gap.
  const driver = ctx.driverName || t("common.brand");

  return (
    <Frame ctx={ctx} preheader={t(`status.${status}.heading`)}>
      <Block dir={dir}>
        <Heading dir={dir}>{t(`status.${status}.heading`)}</Heading>
        <Paragraph dir={dir} muted>
          {t(`status.${status}.body`, {
            driver,
            date: ctx.dateLong,
            time: ctx.startTime,
            address: ctx.addressFull,
          })}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <ReferenceBadge label={t("common.reference")} value={ctx.reference} />
      </Block>

      <Block dir={dir} paddingTop={20}>
        <DetailTable dir={dir} rows={bookingRows(ctx)} />
      </Block>

      {surveyHref && (
        <>
          <Block dir={dir} paddingTop={20}>
            <EmailButton href={surveyHref}>
              {t("bookingSurvey.cta")}
            </EmailButton>
          </Block>
          <Block dir={dir} paddingTop={12}>
            <Paragraph dir={dir} muted>
              {t("bookingSurvey.note")}
            </Paragraph>
          </Block>
        </>
      )}

      <ContactBlock ctx={ctx} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Operational alerts (admin)
// ---------------------------------------------------------------------------

export function AdminRefundRequiredEmail(ctx: TemplateContext): ReactElement {
  const { t, dir, payload } = ctx;

  return (
    <Frame ctx={ctx} preheader={t("adminRefundRequired.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("adminRefundRequired.heading")}</Heading>
      </Block>

      <Block dir={dir} paddingTop={4}>
        <Callout dir={dir} tone="danger">
          {t("adminRefundRequired.intro", { reference: ctx.reference })}
        </Callout>
      </Block>

      <Block dir={dir} paddingTop={20}>
        <DetailTable
          dir={dir}
          rows={[
            {
              label: t("common.reference"),
              value: ctx.reference,
              isolate: true,
            },
            { label: t("common.customer"), value: ctx.customerName },
            {
              label: t("common.phone"),
              value: ctx.customerPhone,
              isolate: true,
            },
            { label: t("common.date"), value: ctx.dateLong, isolate: true },
            {
              label: t("adminRefundRequired.amount"),
              value: ctx.total,
              isolate: true,
              strong: true,
            },
          ]}
        />
      </Block>

      <Block dir={dir} paddingTop={22}>
        <EmailButton href={ctx.adminLink}>
          {t("adminBookingConfirmed.cta")}
        </EmailButton>
      </Block>

      {payload.notes ? (
        <Block dir={dir} paddingTop={0}>
          <></>
        </Block>
      ) : (
        <></>
      )}
    </Frame>
  );
}

export function AdminNotificationFailedEmail(
  ctx: TemplateContext,
): ReactElement {
  const { t, dir, payload } = ctx;

  return (
    <Frame ctx={ctx} preheader={t("adminNotificationFailed.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("adminNotificationFailed.heading")}</Heading>
      </Block>

      <Block dir={dir} paddingTop={4}>
        <Callout dir={dir} tone="danger">
          {t("adminNotificationFailed.intro", {
            attempts: payload.failed_attempts ?? 0,
            reference: ctx.reference,
          })}
        </Callout>
      </Block>

      <Block dir={dir} paddingTop={20}>
        <DetailTable
          dir={dir}
          rows={[
            {
              label: t("adminNotificationFailed.channel"),
              value: payload.failed_channel ?? "",
            },
            {
              label: t("adminNotificationFailed.template"),
              value: payload.failed_template_key ?? "",
            },
            {
              label: t("adminNotificationFailed.recipient"),
              value: payload.failed_recipient ?? "",
              isolate: true,
            },
            {
              label: t("adminNotificationFailed.error"),
              value: payload.failed_error ?? "",
            },
          ]}
        />
      </Block>

      <Block dir={dir} paddingTop={18}>
        <Paragraph dir={dir} small muted>
          {t("adminNotificationFailed.hint")}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <EmailButton href={ctx.adminLink}>
          {t("adminBookingConfirmed.cta")}
        </EmailButton>
      </Block>
    </Frame>
  );
}

/**
 * The post-activity survey.
 *
 * Sent the day after, and deliberately short: it asks one thing, and the only
 * decision on the page is whether to tap the button. A long email asking for
 * feedback is an email nobody finishes.
 *
 * The link carries the review token from the payload. §4g freezes the payload
 * at enqueue time, so a message sent after a retry carries the same token it
 * was minted with rather than one generated later.
 */
/**
 * The survey URL from a payload, or null when there is no token in it.
 *
 * Null is a real outcome, not a defensive check: a booking with no email
 * address is never given a token (see enqueue_completion_with_survey in 0019),
 * and a booking completed twice keeps the first one. Callers render the CTA
 * only when this returns a link, so the alternative to a null check is an
 * email with a button pointing at /r/ and nothing after it.
 */
function reviewHref(payload: TemplateContext["payload"]): string | null {
  const token =
    typeof payload.review_token === "string" ? payload.review_token : "";
  if (token === "") return null;
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${origin}/r/${token}`;
}

export function BookingSurveyEmail(ctx: TemplateContext): ReactElement {
  const { t, dir, payload } = ctx;

  const href = reviewHref(payload) ?? "";

  return (
    <Frame ctx={ctx} preheader={t("bookingSurvey.preheader")}>
      <Block dir={dir}>
        <Heading dir={dir}>{t("bookingSurvey.heading")}</Heading>
        <Paragraph dir={dir} muted>
          {t("bookingSurvey.intro", { name: ctx.customerName })}
        </Paragraph>
      </Block>

      <Block dir={dir} paddingTop={8}>
        <ReferenceBadge label={t("common.reference")} value={ctx.reference} />
      </Block>

      <Block dir={dir} paddingTop={20}>
        <EmailButton href={href}>
          {t("bookingSurvey.cta")}
        </EmailButton>
      </Block>

      <Block dir={dir} paddingTop={16}>
        <Paragraph dir={dir} muted>
          {t("bookingSurvey.note")}
        </Paragraph>
      </Block>
    </Frame>
  );
}

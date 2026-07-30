import "server-only";

import type { ReactElement } from "react";
import {
  AdminBookingConfirmedEmail,
  AdminNotificationFailedEmail,
  AdminRefundRequiredEmail,
  BookingConfirmedEmail,
  DriverAssignmentEmail,
  StatusUpdateEmail,
  type StatusKey,
} from "./emails";
import type { TemplateContext } from "./context";
import type { NotificationLocale, TemplateKey } from "../types";
import WHATSAPP_PARAMS from "./whatsapp-params.json";

/**
 * The template registry — the single map from a `template_key` in the outbox to
 * what actually gets sent.
 *
 * Typed as Record<TemplateKey, …>, so adding a key to TEMPLATE_KEYS without
 * defining it here is a compile error rather than a runtime "template not
 * found" discovered by a customer not receiving anything.
 *
 * A definition may omit either channel. `admin_booking_confirmed` has no
 * WhatsApp form because admins are emailed, and `booking_setup_complete` has
 * both because it is the one customers most want on their phone.
 */

/**
 * How each named parameter is resolved for a given booking.
 *
 * The NAMES and their ORDER live in ./whatsapp-params.json, which the
 * documentation generator reads too — that shared file is what stops the
 * approved Meta template and the parameters we send from drifting apart. This
 * map only says how to turn a name into a value.
 */
const VALUE_RESOLVERS: Record<string, (ctx: TemplateContext) => string> = {
  reference: (ctx) => ctx.reference,
  date: (ctx) => ctx.dateLong,
  time: (ctx) => ctx.startTime,
  address: (ctx) => ctx.addressFull,
  total: (ctx) => ctx.total,
  customer: (ctx) => ctx.customerName,
  phone: (ctx) => ctx.customerPhone,
  maps: (ctx) => ctx.mapsLink,
  arriveBy: (ctx) => ctx.arrivalTime,
  area: (ctx) => ctx.payload.area ?? ctx.payload.city ?? "—",
  /**
   * "QAR 5,450 — paid" or "QAR 5,450 — COLLECT ON SITE".
   *
   * The crew has to know before they arrive whether money is owed; finding out
   * at the villa is how a job ends in an argument.
   */
  payment: (ctx) =>
    ctx.payload.status === "confirmed" ||
    ctx.payload.status === "assigned" ||
    ctx.payload.status === "en_route" ||
    ctx.payload.status === "completed"
      ? `${ctx.total} — ${ctx.t("dispatch.paid")}`
      : `${ctx.total} — ${ctx.t("dispatch.collect")}`,
  /** The capability link. Minted per recipient by create_booking_dispatch(). */
  jobLink: (ctx) =>
    ctx.payload.dispatch_token
      ? `${ctx.siteUrl}/d/${ctx.payload.dispatch_token}`
      : ctx.siteUrl,
  mapsLink: (ctx) => ctx.mapsLink,
  // Not every transition has a driver yet; the brand name reads better than a
  // blank in "… is on the way".
  driver: (ctx) => ctx.driverName || ctx.t("common.brand"),
};

export type WhatsAppDefinition = {
  /** The name registered with Meta. */
  templateName: string;
  /** Key under `notifications.` in the message catalogue. */
  messageKey: string;
  /** Ordered [name, value] pairs; position N becomes Meta's {{N+1}}. */
  params: (ctx: TemplateContext) => Array<[string, string]>;
  /** Maps our locale to the template's approved language code. */
  language?: (locale: NotificationLocale) => string;
};

export type TemplateDefinition = {
  audience: "customer" | "admin" | "driver";
  email?: {
    subjectKey: string;
    subjectValues?: (ctx: TemplateContext) => Record<string, string>;
    render: (ctx: TemplateContext) => ReactElement;
  };
  whatsapp?: WhatsAppDefinition;
};

/** Meta approves one template per language; the code is the locale itself. */
const defaultLanguage = (locale: NotificationLocale) => locale;

/**
 * Builds a definition from the shared JSON contract.
 *
 * Throws on an unknown template name or an unresolvable parameter, at module
 * load, rather than producing a message with the string "undefined" in it.
 */
function whatsapp(templateName: string): WhatsAppDefinition {
  const entry = WHATSAPP_PARAMS.templates[
    templateName as keyof typeof WHATSAPP_PARAMS.templates
  ] as { messageKey: string; params: string[] } | undefined;

  if (!entry) {
    throw new Error(`whatsapp-params.json has no entry for "${templateName}".`);
  }

  return {
    templateName,
    messageKey: entry.messageKey,
    language: defaultLanguage,
    params: (ctx) =>
      entry.params.map((name) => {
        const resolve = VALUE_RESOLVERS[name];
        if (!resolve) {
          throw new Error(
            `whatsapp-params.json uses "${name}" for ${templateName}, ` +
              "which has no resolver in VALUE_RESOLVERS.",
          );
        }
        return [name, resolve(ctx)];
      }),
  };
}

function statusTemplate(status: StatusKey): TemplateDefinition {
  return {
    audience: "customer",
    email: {
      subjectKey: `status.${status}.subject`,
      subjectValues: (ctx) => ({ reference: ctx.reference }),
      render: (ctx) => StatusUpdateEmail(ctx, status),
    },
    whatsapp: whatsapp(`yw_${status}`),
  };
}

export const TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  // --- SRS 3.4.1 — order received -----------------------------------------
  booking_confirmed: {
    audience: "customer",
    email: {
      subjectKey: "bookingConfirmed.subject",
      subjectValues: (ctx) => ({ reference: ctx.reference }),
      render: BookingConfirmedEmail,
    },
    whatsapp: whatsapp("yw_booking_confirmed"),
  },

  // --- SRS 3.4.2 — new booking alert --------------------------------------
  admin_booking_confirmed: {
    audience: "admin",
    email: {
      subjectKey: "adminBookingConfirmed.subject",
      subjectValues: (ctx) => ({
        reference: ctx.reference,
        date: ctx.dateLong,
      }),
      render: AdminBookingConfirmedEmail,
    },
  },

  // --- SRS 3.4.3 — driver assignment --------------------------------------
  driver_assignment: {
    audience: "driver",
    email: {
      subjectKey: "driverAssignment.subject",
      subjectValues: (ctx) => ({
        reference: ctx.reference,
        date: ctx.dateLong,
        time: ctx.arrivalTime,
      }),
      render: DriverAssignmentEmail,
    },
    whatsapp: whatsapp("yw_driver_assignment"),
  },

  /**
   * Phase 9 — the dispatch message.
   *
   * WhatsApp only: there is no driver portal and no driver email. Everything a
   * recipient needs is in the body, and the link opens the job sheet with the
   * full address. The address is deliberately NOT in the message — a forwarded
   * WhatsApp carries it forever, while a link can be revoked and expires.
   */
  dispatch_job: {
    audience: "driver",
    whatsapp: whatsapp("yw_dispatch_job"),
  },

  // --- SRS 3.4.4 — lifecycle status updates -------------------------------
  booking_assigned: statusTemplate("assigned"),
  booking_en_route: statusTemplate("en_route"),
  booking_setup_complete: statusTemplate("setup_complete"),
  booking_completed: statusTemplate("completed"),
  booking_cancelled: statusTemplate("cancelled"),

  // --- Operational alerts --------------------------------------------------
  /**
   * Phase 6 enqueues `payment_refund_required` for the customer alongside the
   * `admin_` copy. The customer is deliberately NOT told "we owe you a refund"
   * by an automated message — a human decides how to word that, and a wrong
   * automated apology is worse than a phone call. So this key renders nothing
   * and the worker treats it as a no-op.
   */
  payment_refund_required: {
    audience: "customer",
  },
  admin_payment_refund_required: {
    audience: "admin",
    email: {
      subjectKey: "adminRefundRequired.subject",
      subjectValues: (ctx) => ({ reference: ctx.reference }),
      render: AdminRefundRequiredEmail,
    },
  },
  admin_notification_failed: {
    audience: "admin",
    email: {
      subjectKey: "adminNotificationFailed.subject",
      subjectValues: (ctx) => ({ reference: ctx.reference }),
      render: AdminNotificationFailedEmail,
    },
  },
};

export { type StatusKey } from "./emails";

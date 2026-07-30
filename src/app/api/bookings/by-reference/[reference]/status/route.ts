import { z } from "zod";
import { getBookingStatus } from "@/lib/payments/service";
import { createPaymentProvider } from "@/lib/payments";
import { settleEvent } from "@/lib/payments/service";
import { sql } from "@/db/client";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const paramsSchema = z.object({
  reference: z.string().regex(/^YW-\d{4}-\d{4}$/),
});

/**
 * GET /api/bookings/by-reference/[reference]/status
 *
 * What the success page polls while it waits for the webhook.
 *
 * `?fallback=1` additionally asks the provider directly. The success page sends
 * that only after ~10s of polling, because it is a paid API call and the webhook
 * normally wins. Even then, a provider-reported "paid" is settled through the
 * SAME function the webhook uses — so a booking recovered this way is confirmed
 * by server-side evidence, never by the browser's say-so.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }
  const reference = resolved.data.reference;

  const useFallback = new URL(request.url).searchParams.get("fallback") === "1";

  if (useFallback) {
    const pending = await sql<{ provider: string; provider_ref: string }[]>`
      SELECT p.provider, p.provider_ref
        FROM payments p
        JOIN bookings b ON b.id = p.booking_id
       WHERE b.reference = ${reference}
         AND p.status = 'initiated'
         AND p.provider_ref IS NOT NULL
       ORDER BY p.created_at DESC
       LIMIT 1
    `;

    const row = pending[0];
    if (row) {
      const provider = createPaymentProvider();
      if (row.provider === provider.name) {
        try {
          const status = await provider.fetchStatus(row.provider_ref);
          if (
            status === "paid" ||
            status === "failed" ||
            status === "cancelled"
          ) {
            await settleEvent(provider.name, {
              eventId: `${row.provider_ref}:${status}:fallback`,
              providerRef: row.provider_ref,
              status,
              raw: { source: "status_fallback", reportedStatus: status },
            });
          }
        } catch (error) {
          // The poll still returns whatever we know; the reconciliation job is
          // the backstop.
          console.error("[payments/status] fallback fetchStatus failed", {
            reference,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const view = await getBookingStatus(reference);
  if (!view) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  const confirmed = ["confirmed", "assigned", "en_route", "completed"].includes(
    view.status,
  );

  return Response.json(
    {
      reference: view.reference,
      status: view.status,
      paymentStatus: view.paymentStatus,
      confirmed,
      // Only sent once confirmed: before that there is nothing to celebrate and
      // no reason to hand out booking details.
      ...(confirmed
        ? {
            bookingDate: view.bookingDate,
            preferredStart: view.preferredStart,
            priceTotal: view.priceTotal,
            currency: view.currency,
            customerName: view.customerName,
            addressLine: view.addressLine,
            area: view.area,
          }
        : {}),
    },
    { status: 200, headers: NO_STORE },
  );
}

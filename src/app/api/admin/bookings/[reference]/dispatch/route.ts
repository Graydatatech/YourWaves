import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { dispatchToPhone } from "@/lib/admin/dispatch";
import { normaliseDriverPhone } from "@/lib/admin/driverPhone";
import { sql } from "@/db/client";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  /** Either an existing saved recipient… */
  recipientId: z.string().uuid().optional(),
  /** …or a one-off name and number. */
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(6).max(24).optional(),
  locale: z.enum(["ar", "en"]).default("en"),
  /** Save the one-off to the recipient list for next time. */
  save: z.boolean().default(false),
  /** A genuine resend: mint a new token so the old link dies. */
  rotate: z.boolean().default(false),
});

/**
 * POST /api/admin/bookings/[reference]/dispatch
 *
 * Adds one recipient to this booking and sends them their own link. Used for
 * "the technician is going too" and for "he lost the message".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { reference } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 422, headers: NO_STORE });
  }

  const bookingRows = await sql<{ id: string }[]>`
    SELECT id FROM bookings WHERE reference = ${reference}
  `;
  const bookingId = bookingRows[0]?.id;
  if (!bookingId) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  let phone: string | null = null;
  let fullName = parsed.data.fullName ?? "";
  let recipientId: string | null = parsed.data.recipientId ?? null;

  if (recipientId) {
    const rows = await sql<{ full_name: string; phone: string; is_active: boolean }[]>`
      SELECT full_name, phone, is_active FROM dispatch_recipients
       WHERE id = ${recipientId}::uuid
    `;
    if (!rows[0]) {
      return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    if (!rows[0].is_active) {
      return Response.json({ error: "recipient_inactive" }, { status: 409, headers: NO_STORE });
    }
    phone = rows[0].phone;
    fullName = rows[0].full_name;
  } else {
    if (!parsed.data.phone || !fullName) {
      return Response.json({ error: "invalid_body" }, { status: 422, headers: NO_STORE });
    }
    phone = normaliseDriverPhone(parsed.data.phone);
    if (!phone) {
      return Response.json({ error: "invalid_phone" }, { status: 422, headers: NO_STORE });
    }

    // "Save for next time" is opt-in: a one-off number for one job should not
    // silently join the permanent list.
    if (parsed.data.save) {
      const saved = await sql<{ id: string }[]>`
        INSERT INTO dispatch_recipients (full_name, phone, role, is_default)
        VALUES (${fullName}, ${phone}, 'other', false)
        ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id
      `;
      recipientId = saved[0]?.id ?? null;
    }
  }

  const result = await dispatchToPhone(auth, bookingId, {
    phone,
    fullName,
    recipientId,
    locale: parsed.data.locale,
    rotate: parsed.data.rotate,
  });

  return Response.json(
    { ok: true, ...result },
    { status: 201, headers: NO_STORE },
  );
}

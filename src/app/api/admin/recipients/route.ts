import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { getDrivers } from "@/lib/admin/queries";
import { createDriver } from "@/lib/admin/mutations";
import { normaliseDriverPhone } from "@/lib/admin/driverPhone";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Dispatch recipients — anyone who should receive a job sheet.
 *
 * BY EMAIL since 0020. The number is still the identity (0009's unique index,
 * and what a dispatcher rings), but the job sheet itself goes to the address.
 *
 * Replaces /api/admin/drivers. Since phase 9 a "driver" is just a recipient
 * with role 'driver'; the same list also holds the owner, a supervisor and the
 * technician, and `isDefault` decides who is told automatically the moment a
 * booking is paid for.
 */
const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(24),
  /**
   * REQUIRED. This is where their job sheets go, so a recipient without one is
   * a person the system cannot reach — and 0020's WhatsApp fallback exists for
   * rows that predate this field, not as a way to keep adding new ones.
   */
  email: z.string().trim().email().max(160),
  role: z.enum(["driver", "owner", "supervisor", "other"]).default("driver"),
  isDefault: z.boolean().default(false),
});

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const recipients = await getDrivers(auth);
  return Response.json({ ok: true, recipients }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 422, headers: NO_STORE });
  }

  // The number is the identity — 0009's unique index, and what a dispatcher
  // rings from the booking screen — so it has to be dialable, not merely
  // plausible, even though the job sheet now goes by email.
  const phone = normaliseDriverPhone(parsed.data.phone);
  if (!phone) {
    return Response.json({ error: "invalid_phone" }, { status: 422, headers: NO_STORE });
  }

  try {
    const result = await createDriver(auth, {
      fullName: parsed.data.fullName,
      phone,
      email: parsed.data.email,
      role: parsed.data.role,
      isDefault: parsed.data.isDefault,
    });
    return Response.json({ ok: true, id: result.id }, { status: 201, headers: NO_STORE });
  } catch (error) {
    // 23505 is the unique phone index from 0009: two recipients sharing a
    // number would each be sent their own link to the same handset.
    if ((error as { code?: string }).code === "23505") {
      return Response.json({ error: "duplicate_phone" }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }
}

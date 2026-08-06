import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { deleteDriver, updateDriver } from "@/lib/admin/mutations";
import { normaliseDriverPhone } from "@/lib/admin/driverPhone";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(6).max(24).optional(),
  /**
   * Optional on a PATCH — this schema is also how "make default" and
   * "deactivate" are posted, and requiring an address there would refuse a
   * toggle on a recipient added before 0020. Validated when it IS sent.
   */
  email: z.string().trim().email().max(160).optional(),
  role: z.enum(["driver", "owner", "supervisor", "other"]).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 422, headers: NO_STORE });
  }

  let phone = parsed.data.phone;
  if (phone) {
    const e164 = normaliseDriverPhone(phone);
    if (!e164) {
      return Response.json({ error: "invalid_phone" }, { status: 422, headers: NO_STORE });
    }
    phone = e164;
  }

  let result;
  try {
    result = await updateDriver(auth, id, { ...parsed.data, phone });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return Response.json({ error: "duplicate_phone" }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }

  // Deactivating is how someone is taken off dispatch, and the 0010 trigger
  // revokes every live link they hold as part of the same statement.
  if (!result.ok && result.code === "has_active_jobs") {
    return Response.json({ error: "has_active_jobs" }, { status: 409, headers: NO_STORE });
  }

  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

/** Only for a recipient who has never been dispatched — see deleteDriver(). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const result = await deleteDriver(auth, id);
  if (result.ok) return Response.json({ ok: true }, { headers: NO_STORE });

  if (result.code === "has_bookings") {
    return Response.json(
      { error: "has_bookings", bookings: result.bookings },
      { status: 409, headers: NO_STORE },
    );
  }
  return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}

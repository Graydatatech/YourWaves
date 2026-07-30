import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { addBlackout, removeBlackout } from "@/lib/admin/mutations";
import { isIsoDate } from "@/lib/dates";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const bodySchema = z.object({
  date: z.string().refine(isIsoDate, { message: "invalid_date" }),
  reason: z.string().trim().max(200).optional(),
});

/**
 * POST /api/admin/blackouts — close a date.
 *
 * Refused with 409 when a live booking already sits on that day. That check is
 * inside `add_blackout_date()` rather than here: hiding a job the crew still
 * has to do is the kind of mistake that must be impossible from every caller,
 * not just from this screen.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await addBlackout(
    auth,
    parsed.data.date,
    parsed.data.reason ?? "",
  );

  if (!result.ok) {
    return Response.json(
      { error: "date_has_booking" },
      { status: 409, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true, id: result.id }, { headers: NO_STORE });
}

/** DELETE /api/admin/blackouts?date=YYYY-MM-DD — reopen a date. */
export async function DELETE(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isIsoDate(date)) {
    return Response.json(
      { error: "invalid_date" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await removeBlackout(auth, date);
  return Response.json(
    { ok: result.ok },
    { status: result.ok ? 200 : 404, headers: NO_STORE },
  );
}

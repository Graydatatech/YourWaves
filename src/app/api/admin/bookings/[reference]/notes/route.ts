import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { addBookingNote } from "@/lib/admin/mutations";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const bodySchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** POST /api/admin/bookings/[reference]/notes — an internal, attributed note. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { reference } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await addBookingNote(auth, reference, parsed.data.body);
  if (!result.ok) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

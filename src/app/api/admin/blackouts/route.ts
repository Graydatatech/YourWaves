import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import {
  addBlackout,
  addBlackoutRange,
  removeBlackout,
} from "@/lib/admin/mutations";
import { differenceInDays, isIsoDate } from "@/lib/dates";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A year is generous; anything longer is almost certainly a typo'd year. */
const MAX_RANGE_DAYS = 366;

const isoDate = z.string().refine(isIsoDate, { message: "invalid_date" });
const reason = z.string().trim().max(200).optional();

const bodySchema = z.union([
  z.object({ date: isoDate, reason }),
  z.object({ from: isoDate, to: isoDate, reason }),
]);

/**
 * POST /api/admin/blackouts — close a date, or a range of dates.
 *
 *   { date, reason? }        → one day; 409 if a live booking sits on it.
 *   { from, to, reason? }    → every day inclusive; days with a live booking
 *                              are skipped and listed in `skipped`. 409 only
 *                              when nothing at all could be closed.
 *
 * The booking check is inside `add_blackout_date()` rather than here: hiding a
 * job the crew still has to do is the kind of mistake that must be impossible
 * from every caller, not just from this screen.
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

  const body = parsed.data;

  if ("date" in body) {
    const result = await addBlackout(auth, body.date, body.reason ?? "");
    if (!result.ok) {
      return Response.json(
        { error: "date_has_booking" },
        { status: 409, headers: NO_STORE },
      );
    }
    return Response.json({ ok: true, id: result.id }, { headers: NO_STORE });
  }

  const span = differenceInDays(body.from, body.to);
  if (span < 0 || span >= MAX_RANGE_DAYS) {
    return Response.json(
      { error: "invalid_range" },
      { status: 422, headers: NO_STORE },
    );
  }

  const result = await addBlackoutRange(
    auth,
    body.from,
    body.to,
    body.reason ?? "",
  );

  if (result.blocked.length === 0) {
    return Response.json(
      { error: "date_has_booking", skipped: result.skipped },
      { status: 409, headers: NO_STORE },
    );
  }

  return Response.json({ ok: true, ...result }, { headers: NO_STORE });
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

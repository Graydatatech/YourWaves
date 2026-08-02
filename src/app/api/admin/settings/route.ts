import { z } from "zod";
import { requireAdmin } from "@/lib/admin/session";
import { updateSettings } from "@/lib/admin/mutations";
import { getAdminSettings } from "@/lib/admin/queries";
import { normaliseTime } from "@/lib/dates";
import { serviceAreaSchema } from "@/lib/booking/serviceArea";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Money is in MINOR UNITS here, as everywhere else in this project. The form
 * converts, so a QAR 4,500 day rate arrives as 450000.
 */
const patchSchema = z.object({
  priceRental: z.number().int().min(0).max(100_000_00).optional(),
  priceSetup: z.number().int().min(0).max(100_000_00).optional(),
  priceDelivery: z.number().int().min(0).max(100_000_00).optional(),
  availableStartTimes: z
    .array(z.string())
    .min(1, { message: "at_least_one_start_time" })
    .max(24)
    .optional(),
  leadTimeHours: z.number().int().min(0).max(720).optional(),
  maxAdvanceDays: z.number().int().min(1).max(730).optional(),
  holdMinutes: z.number().int().min(1).max(120).optional(),
  // Bilingual since 0012. The English name is required — it is the value that
  // ends up on the booking — while Arabic may be left blank and falls back.
  serviceAreas: z.array(serviceAreaSchema).max(50).optional(),
  adminNotificationEmails: z
    .array(z.string().trim().email())
    .max(20)
    .optional(),
  /**
   * Terms & conditions, PLAIN TEXT. 20k is roughly eight pages — generous for
   * real terms, and a bound, because this ends up on a public page and an
   * unbounded text column reachable from a form is a way to fill a database.
   *
   * Not sanitised, because it is never rendered as HTML: the public page splits
   * it on blank lines and prints paragraphs. Accepting markup would let an
   * admin put script on a customer-facing page.
   */
  termsEn: z.string().max(20_000).optional(),
  termsAr: z.string().max(20_000).optional(),
});

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const settings = await getAdminSettings(auth);
  return Response.json({ ok: true, settings }, { headers: NO_STORE });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_body",
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.message,
        })),
      },
      { status: 422, headers: NO_STORE },
    );
  }

  const patch = { ...parsed.data };

  // Times are stored canonically so availability comparisons stay string
  // comparisons — the same normalisation the booking flow uses.
  if (patch.availableStartTimes) {
    try {
      patch.availableStartTimes = [
        ...new Set(patch.availableStartTimes.map(normaliseTime)),
      ].sort();
    } catch {
      return Response.json(
        {
          error: "invalid_body",
          fields: [{ path: "availableStartTimes", code: "invalid_time" }],
        },
        { status: 422, headers: NO_STORE },
      );
    }
  }

  const result = await updateSettings(auth, patch);
  const settings = await getAdminSettings(auth);

  return Response.json(
    { ok: true, changed: result.changed, settings },
    { headers: NO_STORE },
  );
}

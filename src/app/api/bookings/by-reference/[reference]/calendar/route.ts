import { z } from "zod";
import { getBookingStatus } from "@/lib/payments/service";
import { qatarWallClockToInstant } from "@/lib/dates";

const paramsSchema = z.object({
  reference: z.string().regex(/^YW-\d{4}-\d{4}$/),
});

/** RFC 5545 wants CRLF, escaped commas/semicolons, and folded long lines. */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * GET /api/bookings/by-reference/[reference]/calendar — an .ics download.
 *
 * Times are emitted as UTC instants derived from the Qatar wall clock via
 * qatarWallClockToInstant, so the event lands at the right local hour whatever
 * timezone the customer's calendar is set to. Writing the naive local time would
 * put a 09:00 Qatar setup at 09:00 wherever they happen to be.
 *
 * Only confirmed bookings get a file: an .ics for an unpaid hold would sit in
 * someone's calendar as if it were real.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const resolved = paramsSchema.safeParse(await params);
  if (!resolved.success) return new Response("Not found", { status: 404 });

  const booking = await getBookingStatus(resolved.data.reference);
  if (!booking) return new Response("Not found", { status: 404 });

  const confirmed = ["confirmed", "assigned", "en_route", "completed"].includes(
    booking.status,
  );
  if (!confirmed) return new Response("Not confirmed", { status: 409 });

  const start = qatarWallClockToInstant(
    booking.bookingDate,
    booking.preferredStart,
  );
  // A full-day rental: 10 hours on site (see the hero stats).
  const end = new Date(start.getTime() + 10 * 3_600_000);

  const isArabic = booking.locale === "ar";
  const summary = isArabic
    ? "يور ويفز — يوم الموجة"
    : "YourWaves — your wave day";
  const description = isArabic
    ? `الرقم المرجعي: ${booking.reference}\nسيصل فريقنا قبل الموعد للتركيب.`
    : `Reference: ${booking.reference}\nOur crew arrives ahead of time to set up.`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//YourWaves//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.reference}@yourwaves.qa`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape([booking.addressLine, booking.area].filter(Boolean).join(", "))}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="yourwaves-${booking.reference}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

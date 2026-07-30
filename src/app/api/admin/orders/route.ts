import { requireAdmin } from "@/lib/admin/session";
import { getOrders, type OrderFilters } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/booking/format";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Parses the query string into filters, ignoring anything unrecognised. */
export function parseOrderFilters(url: URL): OrderFilters {
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const sort = get("sort");
  const direction = get("direction");

  return {
    search: get("search"),
    status: get("status") as OrderFilters["status"],
    driverId: get("driver"),
    city: get("city"),
    from: get("from"),
    to: get("to"),
    sort:
      sort === "created" || sort === "amount" || sort === "reference"
        ? sort
        : "date",
    direction: direction === "asc" ? "asc" : "desc",
    page: Number(get("page")) || 1,
    pageSize: Number(get("pageSize")) || 25,
  };
}

/** RFC 4180: quote everything, double internal quotes. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * GET /api/admin/orders            → JSON, paginated
 * GET /api/admin/orders?format=csv → CSV, the WHOLE filtered set
 *
 * The export deliberately ignores pagination. An export that silently gave you
 * page one, with no indication it had done so, is worse than no export — the
 * numbers would be wrong in a spreadsheet nobody re-checks.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const filters = parseOrderFilters(url);
  const wantsCsv = url.searchParams.get("format") === "csv";

  const result = await getOrders(auth, filters, { unpaginated: wantsCsv });

  if (!wantsCsv) {
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  }

  const header = [
    "Reference",
    "Date",
    "Start",
    "Status",
    "Customer",
    "Phone",
    "Address",
    "Area",
    "City",
    "Driver",
    "Total",
    "Currency",
    "Created",
  ];

  const lines = [
    header.map(csvCell).join(","),
    ...result.rows.map((row) =>
      [
        row.reference,
        row.bookingDate,
        row.preferredStart,
        row.status,
        row.customerName,
        // Excel eats a leading "+" as a formula; the phone must survive intact.
        `​${row.customerPhone}`,
        row.addressLine,
        row.area ?? "",
        row.city ?? "",
        row.driverName ?? "",
        formatMoney(row.priceTotal, row.currency, "en"),
        row.currency,
        row.createdAt,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(
    // A BOM, so Excel opens it as UTF-8 and Arabic customer names are not
    // rendered as mojibake.
    `﻿${lines.join("\r\n")}\r\n`,
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="yourwaves-bookings-${stamp}.csv"`,
        ...NO_STORE,
      },
    },
  );
}

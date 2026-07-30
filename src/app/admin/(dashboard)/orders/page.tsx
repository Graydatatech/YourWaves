import { Suspense } from "react";
import { getAdminSession } from "@/lib/admin/session";
import { getCities, getDrivers, getOrders } from "@/lib/admin/queries";
import { parseOrderFilters } from "@/app/api/admin/orders/route";
import { PullToRefresh } from "../../components/PullToRefresh";
import { OrdersView } from "./OrdersView";

export const dynamic = "force-dynamic";

/**
 * Orders.
 *
 * The filters are parsed with the SAME function the API route uses, so the
 * table and the CSV export can never disagree about what "?status=confirmed"
 * means — an export that quietly applied different filters than the screen
 * would be the worst kind of wrong.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAdminSession();
  if (!result.ok) return null;

  const params = await searchParams;
  const url = new URL("http://local/orders");
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") url.searchParams.set(key, value);
  }

  const filters = parseOrderFilters(url);

  const [orders, drivers, cities] = await Promise.all([
    getOrders(result.session, filters),
    getDrivers(result.session),
    getCities(result.session),
  ]);

  return (
    <PullToRefresh>
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <OrdersView result={orders} drivers={drivers} cities={cities} />
      </Suspense>
    </PullToRefresh>
  );
}

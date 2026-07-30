import { getAdminSession } from "@/lib/admin/session";
import { getCalendarMonth } from "@/lib/admin/queries";
import { isIsoMonth, qatarToday } from "@/lib/dates";
import { PullToRefresh } from "../../components/PullToRefresh";
import { CalendarView } from "./CalendarView";

export const dynamic = "force-dynamic";

/**
 * Calendar. `?month=YYYY-MM` drives it, so a month is linkable and the browser
 * back button works — state that lives only in React would lose both.
 */
export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const result = await getAdminSession();
  if (!result.ok) return null;

  const params = await searchParams;
  const today = qatarToday();
  const month =
    params.month && isIsoMonth(params.month) ? params.month : today.slice(0, 7);

  const days = await getCalendarMonth(result.session, month);

  return (
    <PullToRefresh>
      <CalendarView month={month} days={days} today={today} />
    </PullToRefresh>
  );
}

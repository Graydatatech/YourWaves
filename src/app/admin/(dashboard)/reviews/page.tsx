import { getAdminSession } from "@/lib/admin/session";
import { getReviews } from "@/lib/admin/queries";
import { adminT } from "@/lib/admin/intl";
import { ReviewsView } from "./ReviewsView";

export const dynamic = "force-dynamic";

/** Survey answers, and which of them appear under "What guests say". */
export default async function AdminReviewsPage() {
  const result = await getAdminSession();
  if (!result.ok) return null;

  const t = adminT();
  const reviews = await getReviews(result.session);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-ink-deep text-xl font-extrabold tracking-tight">
        {t("reviews.title")}
      </h1>
      <p className="text-muted-2 text-sm">{t("reviews.subtitle")}</p>
      <ReviewsView reviews={reviews} />
    </div>
  );
}

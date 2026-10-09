import { getTranslations } from "next-intl/server";

import { ReviewTiles } from "@/components/reviews/review-tiles";
import { getHomeReviews } from "@/lib/store/public-catalog";
import { pickHomeReviews, shouldShowHomeStrip } from "@/lib/reviews/reviews";

// "What customers said" on the home pages (P4-03). Server component on the ISR
// home: reads the cached anon RPCs (tag "parts"), and renders nothing until the
// owner has approved at least three reviews (or before migration 0058 runs).
export async function ReviewsStrip({ locale }: { locale: string }) {
  const { count, reviews } = await getHomeReviews();
  if (!shouldShowHomeStrip(count)) return null;
  const shown = pickHomeReviews(reviews);
  if (shown.length === 0) return null;
  const t = await getTranslations("Reviews");
  return (
    <section aria-labelledby="home-reviews" className="neu animate-fade-up space-y-5 p-5 sm:p-8">
      <div className="space-y-1">
        <span className="kicker block text-cobalt">{t("kicker")}</span>
        <h2 id="home-reviews" className="title-section">
          {t("heading")}
        </h2>
      </div>
      <ReviewTiles reviews={shown} locale={locale} className="lg:grid-cols-3" />
    </section>
  );
}

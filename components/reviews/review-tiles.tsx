import { getTranslations } from "next-intl/server";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { displayName, formatReviewDate, type ApprovedReview } from "@/lib/reviews/reviews";

// Approved customer reviews as flat tiles (P4-03). Server component: used inside
// a .neu section on the (ISR) product page and the home strip, so no card sits
// inside another shadowed card. Only what the owner approved gets here: score,
// the comment if any, first name or "A customer in Qatar", and the date.

export function Stars({ score, label }: { score: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn("h-3.5 w-3.5", n <= score ? "fill-cobalt text-cobalt" : "text-borderstrong")}
          strokeWidth={1.75}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export async function ReviewTiles({
  reviews,
  locale,
  className,
}: {
  reviews: readonly ApprovedReview[];
  locale: string;
  className?: string;
}) {
  const t = await getTranslations("Reviews");
  return (
    <ul className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {reviews.map((r) => (
        <li key={r.id} className="tile min-w-0 space-y-2">
          <Stars score={r.score} label={t("rated", { score: String(r.score) })} />
          {r.comment && (
            <p className="break-words text-sm leading-relaxed text-body" dir="auto">
              {r.comment}
            </p>
          )}
          <p className="text-xs text-mutedtext">
            {t("byline", { name: displayName(r.firstName, t("anonymous")) })}
            <span aria-hidden> · </span>
            <time dateTime={r.createdAt}>{formatReviewDate(r.createdAt, locale)}</time>
          </p>
        </li>
      ))}
    </ul>
  );
}

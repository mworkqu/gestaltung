import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { getOccasions } from "@/lib/store/public-catalog";
import {
  activeOccasions,
  formatOccasionDate,
  occasionBanner,
  occasionHref,
  occasionTitle,
  qatarToday,
} from "@/lib/occasions";
import { cn } from "@/lib/utils";

// The seasonal banner (P3-07): the first occasion that is ON today (Qatar
// date) as a slim dated strip with a link to its collection page, or nothing.
// Server component, cookie-free: the pages that render it stay static / ISR
// (the date is read at render time and refreshed with the 5-minute cache).
// Rendered under the v2 home and v2 store heroes and at the top of the
// default /store listing. Occasion text comes from the data; only the chrome
// ("On now", "Shop the collection") comes from the Occasions messages.
export async function OccasionBanner({ locale }: { locale: string }) {
  const occasions = await getOccasions();
  const today = qatarToday();
  const [occasion] = activeOccasions(occasions, today);
  if (!occasion) return null;

  const t = await getTranslations("Occasions");
  const title = occasionTitle(occasion, locale);
  const line = occasionBanner(occasion, locale);
  const range = t("range", {
    start: formatOccasionDate(occasion.start, locale),
    end: formatOccasionDate(occasion.end, locale),
  });

  return (
    <section
      aria-label={title}
      className="neu animate-fade-up flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8"
    >
      <div className="min-w-0 space-y-1">
        <p className="kicker text-azure">
          {t("onNow")}
          <span className="text-mutedtext"> · {range}</span>
        </p>
        <p className="title-card text-heading">
          <IsolatedTitle text={title} locale={locale} />
        </p>
        {line && (
          <p className="text-sm leading-relaxed text-body">
            <IsolatedTitle text={line} locale={locale} />
          </p>
        )}
      </div>
      <Link
        href={occasionHref(occasion)}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 self-start text-sm font-semibold text-cobalt hover:text-cobalt-hover sm:self-center"
      >
        {t("shop")}
        <ArrowRight className={cn("h-4 w-4", locale === "ar" && "-scale-x-100")} aria-hidden />
      </Link>
    </section>
  );
}

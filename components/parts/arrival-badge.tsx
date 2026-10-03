import { useLocale, useTranslations } from "next-intl";

import { formatDeliveryDate } from "@/lib/store/delivery";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import type { LeadTimeClass } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

// What a customer sees instead of a stock label: "Arrives by 14 October".
// A product with no lead-time class keeps "Available on request" (its date is
// confirmed after the order). With a class but no computable date (shipping
// settings missing) nothing is shown rather than an "In stock" label.
export function ArrivalBadge({
  leadClass,
  date,
  className,
}: {
  leadClass: LeadTimeClass | null | undefined;
  /** ISO date from arrivesByDate / the delivery quote. */
  date: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations("Delivery");
  const locale = useLocale();
  if (!leadClass) return <LeadTimeBadge leadClass={null} className={className} />;
  if (!date) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700",
        className
      )}
    >
      {t("arrivesBy", { date: formatDeliveryDate(date, locale) })}
    </span>
  );
}

import { useTranslations } from "next-intl";

import type { LeadTimeClass } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

const STYLES: Record<LeadTimeClass | "on_request", string> = {
  in_stock: "bg-emerald-500/10 text-emerald-700",
  "3_5_days": "bg-sky-500/10 text-sky-700",
  "1_2_weeks": "bg-indigo-500/10 text-indigo-700",
  "2_4_weeks": "bg-violet-500/10 text-violet-700",
  on_request: "bg-slate-500/10 text-slate-600",
};

// A product's lead-time class (Task 18a). Never "out of stock", never a stock
// number: we say how long it takes, or that it's available on request.
// Works in server and client components.
export function LeadTimeBadge({
  leadClass,
  className,
}: {
  leadClass: LeadTimeClass | null | undefined;
  className?: string;
}) {
  const t = useTranslations("Delivery");
  const key = leadClass ?? "on_request";
  // Spelled out rather than built from the key: a template message key makes
  // the whole "Delivery" namespace (70 keys, admin delivery-settings help text
  // included) reachable, so lib/i18n/scopes.ts has to ship all of it to every
  // page with a product card. Literal calls keep public pages to these five.
  const label =
    key === "in_stock"
      ? t("lt_in_stock")
      : key === "3_5_days"
        ? t("lt_3_5_days")
        : key === "1_2_weeks"
          ? t("lt_1_2_weeks")
          : key === "2_4_weeks"
            ? t("lt_2_4_weeks")
            : t("lt_on_request");
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        STYLES[key],
        className
      )}
    >
      {label}
    </span>
  );
}

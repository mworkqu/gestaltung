import { useTranslations } from "next-intl";

import type { StockStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const STYLES: Record<StockStatus, string> = {
  in_stock: "bg-emerald-500/10 text-emerald-600",
  low_stock: "bg-amber-500/10 text-amber-600",
  out_of_stock: "bg-destructive/10 text-destructive",
};

// Small coloured pill for a part's stock status. Safe to use in server
// components (useTranslations works on the server via next-intl).
export function StockBadge({
  status,
  className,
}: {
  status: StockStatus;
  className?: string;
}) {
  const t = useTranslations("Parts");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
        STYLES[status],
        className
      )}
    >
      {t(`stock_${status}`)}
    </span>
  );
}

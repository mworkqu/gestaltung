import { getTranslations } from "next-intl/server";

import { normaliseOrderStatus, type OrderStatus } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

const TONE: Record<OrderStatus, string> = {
  confirmed: "bg-sky-100 text-sky-800",
  paid: "bg-indigo-100 text-indigo-800",
  sourcing: "bg-amber-100 text-amber-800",
  shipped: "bg-violet-100 text-violet-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
};

// Server component: the customer-facing status label (Orders.status_*).
export async function OrderStatusPill({ status, className }: { status: string; className?: string }) {
  const t = await getTranslations("Orders");
  const s = normaliseOrderStatus(status) ?? "confirmed";
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONE[s], className)}>
      {t(`status_${s}`)}
    </span>
  );
}

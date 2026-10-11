import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClipboardList, ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { OrdersTable, type OrderListRow } from "@/components/admin/orders-table";
import { loadOrderLines } from "@/lib/admin/order-lines";
import { parseShowHidden } from "@/lib/orders/admin-rules";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PartsOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const tA = await getTranslations("OrdersAdmin");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // Test and cancelled orders are hidden unless the URL says ?show=all.
  const showHidden = parseShowHidden(sp.show);

  const supabase = await createClient();
  let listQuery = supabase.from("part_orders").select("*, part_order_items(count)").order("created_at", { ascending: false });
  if (!showHidden) listQuery = listQuery.not("is_test", "is", true).neq("status", "cancelled");
  const [{ data, error }, hiddenRes] = await Promise.all([
    listQuery,
    supabase.from("part_orders").select("id", { count: "exact", head: true }).or("is_test.eq.true,status.eq.cancelled"),
  ]);
  const hiddenCount = hiddenRes.error ? 0 : (hiddenRes.count ?? 0);

  const orders = (data ?? []) as unknown as OrderListRow[];
  const { byOrder, failed: linesFailed } = error
    ? { byOrder: new Map(), failed: false }
    : await loadOrderLines(
        supabase,
        orders.map((o) => o.id)
      );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">
            {t("ordersTitle")}
          </h1>
          <p className="mt-1 text-sm text-mutedtext">
            {t("ordersCount", { count: orders.length })}
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/dashboard/store">
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
            {t("backToCatalog")}
          </Link>
        </Button>
      </div>

      {(hiddenCount > 0 || showHidden) && (
        <p className="mt-4 text-sm text-mutedtext">
          <Link
            href={showHidden ? "/dashboard/store/orders" : "/dashboard/store/orders?show=all"}
            className="font-semibold text-cobalt hover:underline"
          >
            {showHidden ? tA("hide_hidden") : tA("show_hidden", { count: hiddenCount })}
          </Link>
        </p>
      )}

      {error && (
        <p className="mt-8 text-sm font-medium text-destructive">
          {t("error_unknown")}
        </p>
      )}

      {linesFailed && (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          {tA("lines_failed")}
        </p>
      )}

      {!error && orders.length === 0 && (
        <div className="neu mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <ClipboardList className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <p className="text-base font-semibold text-heading">{t("ordersEmptyTitle")}</p>
          <p className="text-sm text-mutedtext">{t("ordersEmptyBody")}</p>
        </div>
      )}

      {!error && orders.length > 0 && <OrdersTable orders={orders} lines={byOrder} locale={locale} />}
    </div>
  );
}

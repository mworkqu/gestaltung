import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClipboardList, ArrowLeft } from "lucide-react";

import type { PartOrder } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { OrderStatusSelect } from "@/components/parts/order-status-select";
import { WhatsappSentToggle } from "@/components/parts/whatsapp-sent-toggle";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type OrderRow = PartOrder & { part_order_items: { count: number }[] };

export default async function PartsOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part_orders")
    .select("*, part_order_items(count)")
    .order("created_at", { ascending: false });

  const orders = (data ?? []) as unknown as OrderRow[];

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const areaLabel = (area: string) =>
    (DELIVERY_AREAS as readonly string[]).includes(area)
      ? t(`area_${area}`)
      : area;

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

      {error && (
        <p className="mt-8 text-sm font-medium text-destructive">
          {t("error_unknown")}
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

      {!error && orders.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-2">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <Th mono={mono}>{t("colOrderId")}</Th>
                <Th mono={mono}>{t("colDate")}</Th>
                <Th mono={mono}>{t("colCustomer")}</Th>
                <Th mono={mono}>{t("colPhone")}</Th>
                <Th mono={mono}>{t("colArea")}</Th>
                <Th mono={mono} numeric>
                  {t("colItems")}
                </Th>
                <Th mono={mono} numeric>
                  {t("colTotal")}
                </Th>
                <Th mono={mono}>{t("colStatus")}</Th>
                <Th mono={mono}>{t("colWhatsapp")}</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const itemCount = o.part_order_items?.[0]?.count ?? 0;
                return (
                  <tr
                    key={o.id}
                    className="border-b border-borderstrong/40 last:border-0 hover:bg-panel/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/store/orders/${o.id}`}
                        className="font-mono text-xs text-cobalt hover:underline"
                      >
                        {o.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-body">
                      {dateFmt.format(new Date(o.created_at))}
                    </td>
                    <td className="px-4 py-3 font-medium text-heading">
                      {o.customer_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-mutedtext" dir="ltr">
                      {o.customer_phone}
                    </td>
                    <td className="px-4 py-3 text-body">{areaLabel(o.delivery_area)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-body">
                      {itemCount}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums font-semibold text-heading">
                      {formatPrice(o.total_qar, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusSelect id={o.id} status={o.status} />
                    </td>
                    <td className="px-4 py-3">
                      <WhatsappSentToggle id={o.id} sent={o.whatsapp_sent} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  mono,
  numeric,
}: {
  children: React.ReactNode;
  mono: (extra?: string) => string;
  numeric?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-semibold text-mutedtext",
        numeric ? "text-end" : "text-start",
        mono()
      )}
    >
      {children}
    </th>
  );
}

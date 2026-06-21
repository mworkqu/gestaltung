import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import type { PartOrder, PartOrderItem } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { OrderStatusSelect } from "@/components/parts/order-status-select";
import { WhatsappSentToggle } from "@/components/parts/whatsapp-sent-toggle";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data: orderData } = await supabase
    .from("part_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const order = orderData as PartOrder | null;
  if (!order) notFound();

  const { data: itemData } = await supabase
    .from("part_order_items")
    .select("*")
    .eq("order_id", id);
  const items = (itemData ?? []) as PartOrderItem[];

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const areaLabel = (DELIVERY_AREAS as readonly string[]).includes(order.delivery_area)
    ? t(`area_${order.delivery_area}`)
    : order.delivery_area;

  const field = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-borderstrong/40 py-2.5 last:border-0">
      <dt className={mono("text-[10px] text-mutedtext")}>{label}</dt>
      <dd className="text-end text-sm text-body">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">
            {t("orderRef", { id: order.id.slice(0, 8) })}
          </h1>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/dashboard/parts/orders">
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
            {t("backToOrders")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* Line items */}
        <div className="neu overflow-x-auto p-2">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <th className={cn("px-4 py-3 text-start text-[10px] font-semibold text-mutedtext", mono())}>
                  {t("colName")}
                </th>
                <th className={cn("px-4 py-3 text-start text-[10px] font-semibold text-mutedtext", mono())}>
                  {t("colSku")}
                </th>
                <th className={cn("px-4 py-3 text-end text-[10px] font-semibold text-mutedtext", mono())}>
                  {t("colQty")}
                </th>
                <th className={cn("px-4 py-3 text-end text-[10px] font-semibold text-mutedtext", mono())}>
                  {t("colUnitPrice")}
                </th>
                <th className={cn("px-4 py-3 text-end text-[10px] font-semibold text-mutedtext", mono())}>
                  {t("colLineTotal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-borderstrong/40 last:border-0">
                  <td className="px-4 py-3 font-medium text-heading">{it.part_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-mutedtext">{it.part_sku}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-body">{it.quantity}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-body">
                    {formatPrice(it.unit_price_qar, locale)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums font-semibold text-heading">
                    {formatPrice(it.line_total_qar, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-borderstrong/60">
                <td colSpan={4} className="px-4 py-3 text-end text-sm font-semibold text-heading">
                  {t("colTotal")}
                </td>
                <td className="px-4 py-3 text-end tabular-nums text-base font-bold text-heading">
                  {formatPrice(order.total_qar, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Customer + controls */}
        <aside className="space-y-4">
          <dl className="neu p-5">
            {field(t("colCustomer"), order.customer_name)}
            {field(
              t("colPhone"),
              <span dir="ltr" className="font-mono text-xs">
                {order.customer_phone}
              </span>
            )}
            {order.customer_email &&
              field(
                t("emailLabel"),
                <span dir="ltr">{order.customer_email}</span>
              )}
            {field(t("colArea"), areaLabel)}
            {order.delivery_notes && field(t("notesLabel"), order.delivery_notes)}
            {field(t("colDate"), dateFmt.format(new Date(order.created_at)))}
          </dl>

          <div className="neu space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className={mono("text-[10px] text-mutedtext")}>{t("colStatus")}</span>
              <OrderStatusSelect id={order.id} status={order.status} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={mono("text-[10px] text-mutedtext")}>{t("whatsappSent")}</span>
              <WhatsappSentToggle id={order.id} sent={order.whatsapp_sent} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

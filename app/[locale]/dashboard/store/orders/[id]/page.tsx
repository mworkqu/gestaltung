import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import type { PartOrder, PartOrderItem } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { OrderStatusControl } from "@/components/admin/order-status-control";
import { normaliseOrderStatus } from "@/lib/orders/status";
import { WhatsappSentToggle } from "@/components/parts/whatsapp-sent-toggle";
import { cn } from "@/lib/utils";
import { formatDeliveryDate } from "@/lib/store/delivery";

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
  // project_id arrives with 0025 (set only for a customer's own project).
  const items = (itemData ?? []) as (PartOrderItem & { project_id?: string | null })[];

  // Status history (0053). Missing table before 0053 → null ("starts with 0053").
  const { data: historyData, error: historyError } = await supabase
    .from("order_status_history")
    .select("id, status, note, changed_at, changed_by")
    .eq("order_id", id)
    .order("changed_at", { ascending: false });
  const history = historyError
    ? null
    : ((historyData ?? []) as { id: string; status: string; note: string | null; changed_at: string; changed_by: string | null }[]);
  const currentStatus = normaliseOrderStatus(order.status) ?? "confirmed";

  // Order <-> project (SITE_AUDIT #47): each line bought for a project links to
  // it (/projects/<id>; super_admin can open any project under RLS).
  const projectIds = [...new Set(items.map((it) => it.project_id).filter((v): v is string => Boolean(v)))];
  const projectNames = new Map<string, string>();
  if (projectIds.length) {
    const { data: projData, error: projError } = await supabase.from("projects").select("id, name").in("id", projectIds);
    // Without names the links still work; they show the generic label.
    if (projError) console.error("order detail: project names", projError);
    for (const pr of projData ?? []) projectNames.set(pr.id as string, pr.name as string);
  }
  const soleProject = projectIds.length === 1 && items.every((it) => it.project_id === projectIds[0]) ? projectIds[0] : null;

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Shipping + promise (0029); absent on older orders.
  const tD = await getTranslations("Delivery");
  const tPay = await getTranslations("PayMethods");
  const tCredits = await getTranslations("Credits");
  const ship = order as unknown as {
    shipping_tier?: string | null;
    split_shipments?: boolean;
    shipping_qar?: number | null;
    handling_fee_qar?: number | null;
    promised_date?: string | null;
    early_promised_date?: string | null;
    held_by?: string | null;
    delay_notified_at?: string | null;
    payment_method?: string | null;
  };
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
          {soleProject && (
            <p className="mt-1 text-sm text-mutedtext">
              <span className={mono("me-2 text-[10px]")}>{t("orderProjectLink")}</span>
              <Link href={`/projects/${soleProject}`} className="font-semibold text-cobalt hover:text-cobalt-hover">
                {projectNames.get(soleProject) ?? soleProject.slice(0, 8)}
              </Link>
            </p>
          )}
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/dashboard/store/orders">
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
            {t("backToOrders")}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
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
                  <td className="px-4 py-3 font-medium text-heading">
                    {it.part_name}
                    {it.project_id && (
                      <Link
                        href={`/projects/${it.project_id}`}
                        className="block text-[11px] font-semibold text-cobalt hover:text-cobalt-hover"
                      >
                        {t("orderProjectLink")}
                        {!soleProject && projectNames.has(it.project_id) ? ` · ${projectNames.get(it.project_id)}` : ""}
                      </Link>
                    )}
                  </td>
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
              {Number((order as { credit_discount_qar?: number }).credit_discount_qar) > 0 && (
                <tr className="border-t border-borderstrong/60">
                  <td colSpan={4} className="px-4 py-2 text-end text-sm text-mutedtext">
                    {tCredits("checkoutLine")}
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums text-sm text-buy">
                    −{formatPrice(Number((order as { credit_discount_qar?: number }).credit_discount_qar), locale)}
                  </td>
                </tr>
              )}
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
            {ship.shipping_tier &&
              field(
                tD("shippingLabel"),
                // The handling fee only when one was charged (0 since 0044).
                `${tD(`tier_${ship.shipping_tier}`)}${ship.split_shipments ? ` · ${tD("twoShipments")}` : ""} · ${Number(ship.shipping_qar ?? 0) > 0 ? formatPrice(Number(ship.shipping_qar), locale) : tD("freeDelivery")}${Number(ship.handling_fee_qar ?? 0) > 0 ? ` + ${formatPrice(Number(ship.handling_fee_qar), locale)}` : ""}`
              )}
            {ship.promised_date &&
              field(
                tD("promised"),
                `${ship.early_promised_date ? `${formatDeliveryDate(ship.early_promised_date, locale)} / ` : ""}${formatDeliveryDate(ship.promised_date, locale)}${ship.held_by ? ` · ${tD("heldBy", { item: ship.held_by })}` : ""}`
              )}
            {ship.delay_notified_at && field(tD("delayNotified"), dateFmt.format(new Date(ship.delay_notified_at)))}
            {ship.payment_method && field(tPay("label"), tPay(`${ship.payment_method}_title`))}
          </dl>

          <div className="neu space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className={mono("text-[10px] text-mutedtext")}>{t("colStatus")}</span>
              <span className="rounded-full bg-panel px-3 py-1 text-xs font-semibold text-heading shadow-neu-inset">
                {t(`order_status_${currentStatus}`)}
              </span>
            </div>
            <div className="border-t border-borderstrong/40 pt-4">
              <p className={mono("mb-3 text-[10px] text-mutedtext")}>{t("statusChange")}</p>
              <OrderStatusControl key={currentStatus} id={order.id} status={currentStatus} />
            </div>
            <div className="border-t border-borderstrong/40 pt-4">
              <p className={mono("mb-3 text-[10px] text-mutedtext")}>{t("historyTitle")}</p>
              {history === null ? (
                <p className="text-sm text-mutedtext">{t("historyNeedsMigration")}</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-mutedtext">{t("historyEmpty")}</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((h) => {
                    const s = normaliseOrderStatus(h.status);
                    return (
                      <li key={h.id} className="text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold text-heading">{s ? t(`order_status_${s}`) : h.status}</span>
                          <span className="text-[12px] text-mutedtext">{dateFmt.format(new Date(h.changed_at))}</span>
                        </div>
                        {h.note && <p className="mt-0.5 whitespace-pre-line text-body">{h.note}</p>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-borderstrong/40 pt-4">
              <span className={mono("text-[10px] text-mutedtext")}>{t("whatsappSent")}</span>
              <WhatsappSentToggle id={order.id} sent={order.whatsapp_sent} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

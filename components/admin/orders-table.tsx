import { getTranslations } from "next-intl/server";
import { Package } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Hint } from "@/components/ui/hint";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { OrderNextStep, OrderStatusPill } from "@/components/admin/order-controls";
import { WhatsappSentToggle } from "@/components/parts/whatsapp-sent-toggle";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS } from "@/lib/parts/constants";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import { normaliseOrderStatus } from "@/lib/orders/status";
import { suppliersOfOrder } from "@/lib/orders/line-suppliers";
import type { OrderLine } from "@/lib/admin/order-lines";
import type { PartOrder } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { intlTag, asLocale } from "@/lib/locale";

export type OrderListRow = PartOrder & {
  is_test?: boolean | null;
  payment_method?: string | null;
  part_order_items?: { count: number }[];
};

const MAX_THUMBS = 3;

/**
 * The owner's order list table (D3): every column header and status has a short
 * hint, one next-step button per order, product photos in the Items column.
 * Rows only; the page owns the query, filters and paging.
 */
export async function OrdersTable({
  orders,
  lines,
  locale,
}: {
  orders: OrderListRow[];
  /** Lines by order id; a missing entry falls back to the item count. */
  lines: Map<string, OrderLine[]>;
  locale: string;
}) {
  const t = await getTranslations("PartsDashboard");
  const tA = await getTranslations("OrdersAdmin");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const dateFmt = new Intl.DateTimeFormat(intlTag(asLocale(locale)), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const areaLabel = (area: string) => ((DELIVERY_AREAS as readonly string[]).includes(area) ? t(`area_${area}`) : area);

  const Th = ({ children, hint, numeric }: { children: React.ReactNode; hint: string; numeric?: boolean }) => (
    <th className={cn("px-4 py-3 text-[10px] font-semibold text-mutedtext", numeric ? "text-end" : "text-start", mono())}>
      <span className="inline-flex items-center gap-1.5">
        {children}
        <Hint label={hint} />
      </span>
    </th>
  );

  return (
    <div className="neu mt-8 overflow-x-auto p-2" data-testid="orders-table">
      <table className="w-full min-w-[1080px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-borderstrong/60">
            <Th hint={tA("col_order_hint")}>{t("colOrderId")}</Th>
            <Th hint={tA("col_date_hint")}>{t("colDate")}</Th>
            <Th hint={tA("col_customer_hint")}>{t("colCustomer")}</Th>
            <Th hint={tA("col_phone_hint")}>{t("colPhone")}</Th>
            <Th hint={tA("col_area_hint")}>{t("colArea")}</Th>
            <Th hint={tA("col_items_hint")}>{t("colItems")}</Th>
            <Th hint={tA("col_total_hint")} numeric>
              {t("colTotal")}
            </Th>
            <Th hint={tA("col_status_hint")}>{t("colStatus")}</Th>
            <Th hint={tA("col_next_hint")}>{tA("col_next")}</Th>
            <Th hint={tA("col_whatsapp_hint")}>
              <WhatsAppIcon className="text-[#25D366]" />
              <span className="max-w-[9rem] whitespace-normal leading-tight">{tA("col_whatsapp")}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const orderLines = lines.get(o.id) ?? [];
            const itemCount = orderLines.length || (o.part_order_items?.[0]?.count ?? 0);
            const status = normaliseOrderStatus(o.status) ?? "confirmed";
            const supplierNames = suppliersOfOrder(orderLines).map((s) => s.name);
            const thumbs = orderLines.filter((l) => l.photo).slice(0, MAX_THUMBS);
            const muted = o.is_test === true || status === "cancelled";
            return (
              <tr
                key={o.id}
                data-testid={`order-row-${o.id.slice(0, 8)}`}
                className={cn("border-b border-borderstrong/40 last:border-0 hover:bg-panel/50", muted && "opacity-70")}
              >
                <td className="px-4 py-3">
                  <Link href={`/dashboard/store/orders/${o.id}`} className="font-mono text-xs text-cobalt hover:underline">
                    {o.id.slice(0, 8)}
                  </Link>
                  {o.is_test === true && (
                    <span className="ms-2 inline-flex rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-mutedtext">{tA("badge_test")}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-body">{dateFmt.format(new Date(o.created_at))}</td>
                <td className="px-4 py-3 font-medium text-heading">{o.customer_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-mutedtext" dir="ltr">
                  {formatPhoneDisplay(o.customer_phone)}
                </td>
                <td className="px-4 py-3 text-body">{areaLabel(o.delivery_area)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {thumbs.length > 0 ? (
                      <span className="flex -space-x-2 rtl:space-x-reverse">
                        {thumbs.map((l) => (
                          // eslint-disable-next-line @next/next/no-img-element -- hotlinked supplier photos, resized by the CDN
                          <img
                            key={l.id}
                            src={sizedImage(l.photo, IMAGE_WIDTHS.thumb) ?? l.photo!}
                            alt=""
                            width={32}
                            height={32}
                            loading="lazy"
                            className="h-8 w-8 rounded-md border border-white bg-white object-contain"
                          />
                        ))}
                      </span>
                    ) : (
                      <Package className="h-5 w-5 text-faint" aria-hidden="true" />
                    )}
                    <span className="tabular-nums text-body">{itemCount}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-end tabular-nums font-semibold text-heading">{formatPrice(o.total_qar, locale)}</td>
                <td className="px-4 py-3">
                  <OrderStatusPill status={o.status} />
                </td>
                <td className="px-4 py-3">
                  <OrderNextStep id={o.id} status={o.status} paymentMethod={o.payment_method} supplierNames={supplierNames} />
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
  );
}

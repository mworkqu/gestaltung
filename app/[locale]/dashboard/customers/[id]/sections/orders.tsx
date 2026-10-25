// Part orders.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import { Link } from "@/i18n/navigation";
import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, type CustomerFmt } from "../panel";

export function OrdersSection({ orders, unavailable, f }: {
  orders: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, money, yesNo } = f;
  return (
    <Panel title={t("secOrders")} unavailable={unavailable} empty={!orders?.length} noneLabel={t("noneOrders")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cOrder")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cArea")}</th>
            <th className={cn(th, "text-start")}>{t("cMethod")}</th>
            <th className={cn(th, "text-start")}>{t("cTest")}</th>
            <th className={cn(th, "text-end")}>{t("cShipping")}</th>
            <th className={cn(th, "text-end")}>{t("cDiscount")}</th>
            <th className={cn(th, "text-end")}>{t("cTotal")}</th>
            <th className={cn(th, "text-end")}>{t("cCreated")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(orders ?? []).map((o) => (
            <tr key={String(o.id)}>
              <td className="py-2 text-heading">
                <Link href={`/dashboard/store/orders/${String(o.id)}`} className="font-mono text-[11.5px] underline-offset-2 hover:underline" dir="ltr">
                  {String(o.id).slice(0, 8)}
                </Link>
              </td>
              <td className={td}>{text(o.status)}</td>
              <td className={td}>{text(o.delivery_area)}</td>
              <td className={td}>{text(o.payment_method)}</td>
              <td className={td}>{yesNo(o.is_test)}</td>
              <td className={tdn}>{money(o.shipping_qar)}</td>
              <td className={tdn}>{money(o.discount_qar)}</td>
              <td className={cn(tdn, "font-semibold text-heading")}>{money(o.total_qar)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

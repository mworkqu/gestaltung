// Lines of the customer's part orders.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, tdn, tdm, type CustomerFmt } from "../panel";

export function ItemsSection({ items, unavailable, f }: {
  items: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, count, money } = f;
  return (
    <Panel title={t("secItems")} unavailable={unavailable} empty={!items?.length} noneLabel={t("noneItems")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cOrder")}</th>
            <th className={cn(th, "text-start")}>{t("cSku")}</th>
            <th className={cn(th, "text-start")}>{t("cPart")}</th>
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-end")}>{t("cQty")}</th>
            <th className={cn(th, "text-end")}>{t("cUnitPrice")}</th>
            <th className={cn(th, "text-end")}>{t("cLineTotal")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(items ?? []).map((i) => (
            <tr key={String(i.id)}>
              <td className={tdm} dir="ltr">{String(i.order_id ?? "").slice(0, 8) || "—"}</td>
              <td className={tdm} dir="ltr">{text(i.part_sku)}</td>
              <td className="py-2 text-[12.5px] text-heading">{text(i.part_name)}</td>
              <td className={tdm} dir="ltr">{i.project_id ? String(i.project_id).slice(0, 8) : "—"}</td>
              <td className={tdn}>{count(i.quantity)}</td>
              <td className={tdn}>{money(i.unit_price_qar)}</td>
              <td className={cn(tdn, "font-semibold text-heading")}>{money(i.line_total_qar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

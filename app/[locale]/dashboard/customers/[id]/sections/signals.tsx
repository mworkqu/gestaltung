// Demand signals.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function SignalsSection({ signals, unavailable, f }: {
  signals: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count, clip } = f;
  return (
    <Panel title={t("secSignals")} unavailable={unavailable} empty={!signals?.length} noneLabel={t("noneSignals")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cKind")}</th>
            <th className={cn(th, "text-start")}>{t("cPart")}</th>
            <th className={cn(th, "text-start")}>{t("cSearchTerm")}</th>
            <th className={cn(th, "text-start")}>{t("cSourcePage")}</th>
            <th className={cn(th, "text-start")}>{t("cNote")}</th>
            <th className={cn(th, "text-end")}>{t("cQty")}</th>
            <th className={cn(th, "text-end")}>{t("cServed")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(signals ?? []).map((s) => (
            <tr key={String(s.id)} className="align-top">
              <td className="py-2 text-[12px] text-mutedtext">{time(s.created_at)}</td>
              <td className={td}>{text(s.kind)}</td>
              <td className={tdm} dir="ltr">{s.part_id ? String(s.part_id).slice(0, 8) : text(s.bom_label)}</td>
              <td className="py-2 text-[12px] text-body">{clip(s.search_term, 40)}</td>
              <td className={tdm} dir="ltr">{clip(s.source_page, 40)}</td>
              <td className="py-2 text-[12px] text-body">{clip(s.note, 50)}</td>
              <td className={tdn}>{s.quantity == null ? "—" : count(s.quantity)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.served_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

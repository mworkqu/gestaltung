// CAD generations.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function CadSection({ cad, unavailable, f }: {
  cad: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count, yesNo, clip } = f;
  return (
    <Panel title={t("secCad")} unavailable={unavailable} empty={!cad?.length} noneLabel={t("noneCad")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cRequest")}</th>
            <th className={cn(th, "text-start")}>{t("cTier")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cModel")}</th>
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-end")}>{t("cCharged")}</th>
            <th className={cn(th, "text-end")}>{t("cCreditCost")}</th>
            <th className={cn(th, "text-end")}>{t("cDelivered")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(cad ?? []).map((g) => (
            <tr key={String(g.id)} className="align-top">
              <td className="py-2 text-[12px] text-mutedtext">{time(g.created_at)}</td>
              <td className="py-2 text-[12px] text-body">{clip(g.request, 70)}</td>
              <td className={td}>{text(g.tier)}</td>
              <td className={cn(td, g.status === "failed" ? "font-medium text-destructive" : "")}>{text(g.status)}</td>
              <td className={tdm} dir="ltr">{text(g.model)}</td>
              <td className={tdm} dir="ltr">{g.project_id ? String(g.project_id).slice(0, 8) : "—"}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{yesNo(g.charged)}</td>
              <td className={tdn}>{count(g.credit_cost)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(g.delivered_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

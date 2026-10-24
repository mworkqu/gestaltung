// AI usage rolled up per model.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { AiModelSummary } from "@/lib/admin/customer-export";
import { cn } from "@/lib/utils";
import { Panel, th, tdn, type CustomerFmt } from "../panel";

export function AiSection({ byModel, unavailable, f }: {
  byModel: AiModelSummary[];
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, time, num, usd } = f;
  return (
    <Panel title={t("secAi")} unavailable={unavailable} empty={!byModel.length} noneLabel={t("noneAi")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cModel")}</th>
            <th className={cn(th, "text-end")}>{t("cCalls")}</th>
            <th className={cn(th, "text-end")}>{t("cTokensIn")}</th>
            <th className={cn(th, "text-end")}>{t("cTokensOut")}</th>
            <th className={cn(th, "text-end")}>{t("cCost")}</th>
            <th className={cn(th, "text-end")}>{t("cLastCall")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {byModel.map((m) => (
            <tr key={m.model}>
              <td className="py-2 font-mono text-[12px] text-heading" dir="ltr">{m.model}</td>
              <td className={tdn}>{num.format(m.calls)}</td>
              <td className={tdn}>{num.format(m.promptTokens)}</td>
              <td className={tdn}>{num.format(m.completionTokens)}</td>
              <td className={cn(tdn, "font-semibold text-heading")}>{m.unpriced && m.costUsd === 0 ? "—" : usd(m.costUsd)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(m.lastCallAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

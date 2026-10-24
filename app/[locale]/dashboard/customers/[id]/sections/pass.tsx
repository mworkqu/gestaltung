// Idea pass.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, tdm, type CustomerFmt } from "../panel";

export function PassSection({ pass, unavailable, f }: {
  pass: CustomerRow | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, time } = f;
  return (
    <Panel title={t("secPass")} unavailable={unavailable} empty={!pass} noneLabel={t("nonePass")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cStarted")}</th>
            <th className={cn(th, "text-start")}>{t("cActiveUntil")}</th>
            <th className={cn(th, "text-start")}>{t("cUpdated")}</th>
            <th className={cn(th, "text-end")}>{t("cPayment")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          <tr>
            <td className="py-2 text-[12px] text-mutedtext">{time(pass?.started_at)}</td>
            <td className="py-2 text-[12.5px] font-semibold text-heading">{time(pass?.active_until)}</td>
            <td className="py-2 text-[12px] text-mutedtext">{time(pass?.updated_at)}</td>
            <td className={cn(tdm, "text-end")} dir="ltr">{pass?.last_payment_id ? String(pass.last_payment_id).slice(0, 8) : "—"}</td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

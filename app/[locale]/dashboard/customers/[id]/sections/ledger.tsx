// Credits ledger.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function LedgerSection({ ledger, unavailable, f }: {
  ledger: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, day, time, count, clip } = f;
  return (
    <Panel title={t("secLedger")} unavailable={unavailable} empty={!ledger?.length} noneLabel={t("noneLedger")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cKind")}</th>
            <th className={cn(th, "text-end")}>{t("cDelta")}</th>
            <th className={cn(th, "text-start")}>{t("cReason")}</th>
            <th className={cn(th, "text-start")}>{t("cNote")}</th>
            <th className={cn(th, "text-start")}>{t("cRedeemable")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(ledger ?? []).map((l) => (
            <tr key={String(l.id)}>
              <td className="py-2 text-[12px] text-mutedtext">{time(l.created_at)}</td>
              <td className={td}>{text(l.kind)}</td>
              <td className={cn(tdn, Number(l.delta ?? 0) < 0 ? "text-body" : "font-semibold text-heading")}>{count(l.delta)}</td>
              <td className={tdm} dir="ltr">{text(l.reason)}</td>
              <td className="py-2 text-[12px] text-body">{clip(l.note, 60)}</td>
              <td className="py-2 text-[12px] text-mutedtext">{day(l.redeemable_until)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

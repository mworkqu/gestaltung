// Payments.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function PaymentsSection({ payments, unavailable, f }: {
  payments: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count, money, yesNo } = f;
  return (
    <Panel title={t("secPayments")} unavailable={unavailable} empty={!payments?.length} noneLabel={t("nonePayments")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cKind")}</th>
            <th className={cn(th, "text-start")}>{t("cProduct")}</th>
            <th className={cn(th, "text-start")}>{t("cReference")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cTest")}</th>
            <th className={cn(th, "text-end")}>{t("cTokens")}</th>
            <th className={cn(th, "text-end")}>{t("cAuto")}</th>
            <th className={cn(th, "text-end")}>{t("cAmount")}</th>
            <th className={cn(th, "text-end")}>{t("cApproved")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(payments ?? []).map((p) => (
            <tr key={String(p.id)}>
              <td className="py-2 text-[12px] text-mutedtext">{time(p.created_at)}</td>
              <td className={td}>{text(p.kind)}</td>
              <td className={tdm} dir="ltr">{text(p.product)}</td>
              <td className={tdm} dir="ltr">{text(p.reference_code)}</td>
              <td className={td}>{text(p.status)}</td>
              <td className={td}>{yesNo(p.is_test)}</td>
              <td className={tdn}>{count(p.tokens)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{yesNo(p.auto_approved)}</td>
              <td className={cn(tdn, "font-semibold text-heading")}>{money(p.amount_qar)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(p.approved_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

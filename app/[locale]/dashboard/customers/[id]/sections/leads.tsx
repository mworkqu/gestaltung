// Inquiries matched to this customer (lib/admin/customer-export.ts leadMatchesCustomer).
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function LeadsSection({ leads, unavailable, f }: {
  leads: CustomerRow[];
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, money, clip } = f;
  return (
    <Panel title={t("secLeads")} unavailable={unavailable} empty={!leads.length} noneLabel={t("noneLeads")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cName")}</th>
            <th className={cn(th, "text-start")}>{t("cPhone")}</th>
            <th className={cn(th, "text-start")}>{t("cEmail")}</th>
            <th className={cn(th, "text-start")}>{t("cMessage")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-end")}>{t("cQuote")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {leads.map((l) => (
            <tr key={String(l.id)} className="align-top">
              <td className="py-2 text-[12px] text-mutedtext">{time(l.created_at)}</td>
              <td className="py-2 text-[12.5px] text-heading">{text(l.name)}</td>
              <td className={tdm} dir="ltr">
                {l.phone && toWhatsAppDigits(String(l.phone)) ? (
                  <a href={`https://wa.me/${toWhatsAppDigits(String(l.phone))}`} target="_blank" rel="noopener noreferrer" className="font-medium text-cobalt hover:underline">
                    {formatPhoneDisplay(String(l.phone))}
                  </a>
                ) : (
                  text(l.phone)
                )}
              </td>
              <td className={tdm} dir="ltr">{text(l.email)}</td>
              <td className="py-2 text-[12px] text-body">{clip(l.message)}</td>
              <td className={td}>{text(l.status)}</td>
              <td className={tdm} dir="ltr">{l.project_id ? String(l.project_id).slice(0, 8) : "—"}</td>
              <td className={tdn}>{l.final_quote_qar == null ? "—" : money(l.final_quote_qar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// Notification outbox.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function OutboxSection({ outbox, unavailable, f }: {
  outbox: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count, clip } = f;
  return (
    <Panel title={t("secOutbox")} unavailable={unavailable} empty={!outbox?.length} noneLabel={t("noneOutbox")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cKind")}</th>
            <th className={cn(th, "text-start")}>{t("cEmail")}</th>
            <th className={cn(th, "text-start")}>{t("cLocale")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cLastError")}</th>
            <th className={cn(th, "text-end")}>{t("cAttempts")}</th>
            <th className={cn(th, "text-end")}>{t("cSent")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(outbox ?? []).map((n) => (
            <tr key={String(n.id)} className="align-top">
              <td className="py-2 text-[12px] text-mutedtext">{time(n.created_at)}</td>
              <td className={tdm} dir="ltr">{text(n.kind)}</td>
              <td className={tdm} dir="ltr">{text(n.email)}</td>
              <td className={tdm} dir="ltr">{text(n.locale)}</td>
              <td className={td}>{text(n.status)}</td>
              <td className={cn("py-2 text-[12px]", n.last_error ? "font-medium text-destructive" : "text-mutedtext")}>{clip(n.last_error, 50)}</td>
              <td className={tdn}>{count(n.attempts)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(n.sent_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

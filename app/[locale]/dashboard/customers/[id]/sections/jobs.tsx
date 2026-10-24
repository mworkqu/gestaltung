// Engineering jobs.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function JobsSection({ jobs, unavailable, f }: {
  jobs: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count, yesNo } = f;
  return (
    <Panel title={t("secJobs")} unavailable={unavailable} empty={!jobs?.length} noneLabel={t("noneJobs")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cKind")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-start")}>{t("cTest")}</th>
            <th className={cn(th, "text-end")}>{t("cTokens")}</th>
            <th className={cn(th, "text-end")}>{t("cEta")}</th>
            <th className={cn(th, "text-end")}>{t("cReady")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(jobs ?? []).map((j) => (
            <tr key={String(j.id)}>
              <td className="py-2 text-[12px] text-mutedtext">{time(j.created_at)}</td>
              <td className={td}>{text(j.kind)}</td>
              <td className={td}>{text(j.status)}</td>
              <td className={tdm} dir="ltr">{j.project_id ? String(j.project_id).slice(0, 8) : "—"}</td>
              <td className={td}>{yesNo(j.is_test)}</td>
              <td className={tdn}>{count(j.tokens)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(j.eta_at)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(j.ready_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

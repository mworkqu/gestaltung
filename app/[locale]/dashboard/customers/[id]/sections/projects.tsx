// Projects, newest first, each with its export link.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, type CustomerFmt } from "../panel";

export function ProjectsSection({ projects, unavailable, f }: {
  projects: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, day, time, yesNo } = f;
  return (
    <Panel title={t("secProjects")} unavailable={unavailable} empty={!projects?.length} noneLabel={t("noneProjects")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-start")}>{t("cStatus")}</th>
            <th className={cn(th, "text-start")}>{t("cStage")}</th>
            <th className={cn(th, "text-start")}>{t("cTest")}</th>
            <th className={cn(th, "text-start")}>{t("cCreated")}</th>
            <th className={cn(th, "text-start")}>{t("cUpdated")}</th>
            <th className={cn(th, "text-end")}>{t("cExport")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(projects ?? []).map((p) => (
            <tr key={String(p.id)}>
              <td className="py-2 text-heading">
                {text(p.name) === "—" ? t("untitled") : String(p.name)}
                <span className="block font-mono text-[10px] text-faint">{String(p.id).slice(0, 8)}</span>
              </td>
              <td className={td}>{text(p.status)}</td>
              <td className={td}>{text(p.stage)}</td>
              <td className={td}>{yesNo(p.is_test)}</td>
              <td className={td}>{day(p.created_at)}</td>
              <td className={td}>{time(p.updated_at)}</td>
              <td className="py-2 text-end text-[12px]">
                <a href={`/api/admin/projects/${String(p.id)}/export?download=1`} className="font-medium text-cobalt hover:underline">
                  {t("download")}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

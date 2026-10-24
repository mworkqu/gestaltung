// Idea sessions.
// One Panel of /dashboard/customers/<id>, split out of page.tsx (R8).

import type { CustomerRow } from "@/lib/admin/customer-data";
import { cn } from "@/lib/utils";
import { Panel, th, td, tdn, tdm, type CustomerFmt } from "../panel";

export function SessionsSection({ sessions, unavailable, f }: {
  sessions: CustomerRow[] | null;
  unavailable?: string;
  f: CustomerFmt;
}) {
  const { t, text, time, count } = f;
  return (
    <Panel title={t("secSessions")} unavailable={unavailable} empty={!sessions?.length} noneLabel={t("noneSessions")}>
      {/* no-scroll: Panel wraps every table in overflow-x-auto */}
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th className={cn(th, "text-start")}>{t("cProject")}</th>
            <th className={cn(th, "text-start")}>{t("cTier")}</th>
            <th className={cn(th, "text-end")}>{t("cEditTurns")}</th>
            <th className={cn(th, "text-end")}>{t("cTokensUsed")}</th>
            <th className={cn(th, "text-end")}>{t("cStarted")}</th>
            <th className={cn(th, "text-end")}>{t("cUpdated")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borderstrong/40">
          {(sessions ?? []).map((s) => (
            <tr key={String(s.project_id)}>
              <td className={tdm} dir="ltr">{String(s.project_id).slice(0, 8)}</td>
              <td className={td}>{text(s.tier)}</td>
              <td className={tdn}>{count(s.edit_turns)}</td>
              <td className={tdn}>{count(s.tokens_used)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.started_at)}</td>
              <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

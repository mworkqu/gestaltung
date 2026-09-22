import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { projectStatus } from "@/lib/admin/project-export";
import { ProjectExportButtons } from "@/components/admin/project-export-buttons";
import { cn } from "@/lib/utils";

// Every project on the platform, for diagnostics. super_admin only (layout +
// RLS). Owner, created, status and last activity per project; filter by
// owner with ?user=<id>. Each row downloads or copies the full project JSON.

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  brief: string | null;
  spec: unknown;
  bom: unknown;
  netlist: unknown;
};

export default async function AdminProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ user?: string }>;
}) {
  const { locale } = await params;
  const { user: userFilter } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("AdminProjects");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qatar",
  });

  const supabase = await createClient();
  const [projRes, profRes, eventsRes, partsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, user_id, created_at, updated_at, brief, spec, bom, netlist")
      .order("updated_at", { ascending: false })
      .limit(2000),
    supabase.from("profiles").select("id, full_name, role").limit(5000),
    // Latest event per project, for "last activity" (0024; empty before it runs).
    supabase.from("project_events").select("project_id, created_at").order("created_at", { ascending: false }).limit(10000),
    supabase.from("project_parts").select("project_id, updated_at").order("updated_at", { ascending: false }).limit(10000),
  ]);
  const all = (projRes.data ?? []) as Row[];
  const profiles = new Map((profRes.data ?? []).map((p) => [p.id as string, p as { id: string; full_name: string | null; role: string }]));

  // Emails live in auth.users; only the service key can read them.
  const emails = new Map<string, { email: string | null; anonymous: boolean }>();
  const service = createServiceClient();
  if (service) {
    const owners = [...new Set(all.map((p) => p.user_id))];
    await Promise.all(
      owners.map(async (id) => {
        const { data } = await service.auth.admin.getUserById(id);
        if (data?.user)
          emails.set(id, {
            email: data.user.email ?? null,
            anonymous: Boolean((data.user as { is_anonymous?: boolean }).is_anonymous),
          });
      })
    );
  }
  const ownerLabel = (id: string) => {
    const e = emails.get(id);
    const p = profiles.get(id);
    if (e?.anonymous) return t("guest");
    return e?.email ?? p?.full_name ?? t("unknownOwner");
  };

  const latest = new Map<string, string>();
  for (const e of [...(eventsRes.data ?? []), ...(partsRes.data ?? [])] as { project_id: string; created_at?: string; updated_at?: string }[]) {
    const at = e.created_at ?? e.updated_at!;
    if (!latest.has(e.project_id) || at > latest.get(e.project_id)!) latest.set(e.project_id, at);
  }
  const lastActivity = (p: Row) => {
    const l = latest.get(p.id);
    return l && l > p.updated_at ? l : p.updated_at;
  };

  const owners = [...new Set(all.map((p) => p.user_id))]
    .map((id) => ({ id, label: ownerLabel(id), count: all.filter((p) => p.user_id === id).length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const rows = (userFilter ? all.filter((p) => p.user_id === userFilter) : all).sort((a, b) =>
    lastActivity(b).localeCompare(lastActivity(a))
  );

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
          {t("filterOwner")}
          <select
            name="user"
            defaultValue={userFilter ?? ""}
            className="rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset"
          >
            <option value="">{t("allOwners", { count: all.length })}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {`${o.label} (${o.count})`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover">
          {t("apply")}
        </button>
      </form>

      {projRes.error && <p className="text-sm font-medium text-destructive">{t("error")}</p>}

      <div className="neu overflow-x-auto p-4">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className="px-3 pb-2 text-start font-medium">{t("colProject")}</th>
              <th className="px-3 pb-2 text-start font-medium">{t("colOwner")}</th>
              <th className="px-3 pb-2 text-start font-medium">{t("colCreated")}</th>
              <th className="px-3 pb-2 text-start font-medium">{t("colStatus")}</th>
              <th className="px-3 pb-2 text-start font-medium">{t("colActivity")}</th>
              <th className="px-3 pb-2 text-end font-medium">{t("colExport")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {rows.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="px-3 py-2.5">
                  <span className="block font-semibold text-heading">{p.name}</span>
                  <span className="font-mono text-[10px] text-faint">{p.id}</span>
                </td>
                <td className="px-3 py-2.5 text-[12.5px] text-heading">
                  {ownerLabel(p.user_id)}
                  <span className="block font-mono text-[10px] text-faint">{p.user_id.slice(0, 8)}</span>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-mutedtext">{dateFmt.format(new Date(p.created_at))}</td>
                <td className="px-3 py-2.5 text-[12px] text-heading">{t(`status_${projectStatus(p as never)}`)}</td>
                <td className="px-3 py-2.5 text-[12px] text-mutedtext">{dateFmt.format(new Date(lastActivity(p)))}</td>
                <td className="px-3 py-2.5 text-end">
                  <ProjectExportButtons projectId={p.id} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-mutedtext">{t("empty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!service && <p className="text-[11px] text-mutedtext">{t("noServiceKey")}</p>}
    </div>
  );
}

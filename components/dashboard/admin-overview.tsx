import { getTranslations } from "next-intl/server";
import { Building2, Boxes, Package, TriangleAlert } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { JOB_STATUSES } from "@/lib/jobs/constants";
import { cn } from "@/lib/utils";

// super_admin command center: read-only aggregates across every tenant. All
// reads go through the RLS server client (super_admin sees all rows).
export async function AdminOverview({ locale }: { locale: string }) {
  const t = await getTranslations("Admin");
  const tJobs = await getTranslations("Jobs");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [tenantsRes, jobsRes, itemsRes] = await Promise.all([
    supabase.from("tenants").select("id, name, type"),
    supabase
      .from("jobs")
      .select("id, title, status, method, created_at, client_tenant_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("inventory_items")
      .select("id, name, unit, quantity, low_stock_threshold, tenant_id"),
  ]);

  const tenants = tenantsRes.data ?? [];
  const jobs = jobsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const tenantName = new Map(tenants.map((x) => [x.id, x.name]));

  const workshops = tenants.filter((x) => x.type === "workshop").length;
  const clients = tenants.filter((x) => x.type === "client").length;

  const statusCounts: Record<string, number> = {};
  for (const s of JOB_STATUSES) statusCounts[s] = 0;
  for (const j of jobs) statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
  const openJobs = jobs.filter(
    (j) => j.status !== "delivered" && j.status !== "cancelled"
  ).length;

  const lowStock = items.filter(
    (i) => i.low_stock_threshold !== null && Number(i.quantity) <= Number(i.low_stock_threshold)
  );

  const recent = jobs.slice(0, 8);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
  });

  const kpis = [
    {
      icon: Building2,
      label: t("tenants"),
      value: String(tenants.length),
      sub: t("tenantsBreakdown", { workshops, clients }),
    },
    {
      icon: Boxes,
      label: t("jobs"),
      value: String(jobs.length),
      sub: t("openJobs", { count: openJobs }),
    },
    {
      icon: Package,
      label: t("inventory"),
      value: String(items.length),
      sub: "",
    },
    {
      icon: TriangleAlert,
      label: t("lowStock"),
      value: String(lowStock.length),
      sub: "",
      alert: lowStock.length > 0,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="neu p-5">
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl bg-panel shadow-neu-sm",
                k.alert ? "text-destructive" : "text-cobalt"
              )}
            >
              <k.icon className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <p className="mt-4 text-3xl font-extrabold tabular-nums text-heading">
              {k.value}
            </p>
            <p className={mono("mt-1 text-[10px] text-mutedtext")}>{k.label}</p>
            {k.sub && <p className="mt-1 text-xs text-body">{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Jobs by status */}
        <div className="neu p-6">
          <p className={mono("text-[10px] text-azure")}>{t("statusTitle")}</p>
          <ul className="mt-4 space-y-2">
            {JOB_STATUSES.map((s) => (
              <li key={s} className="flex items-center justify-between gap-4">
                <span className="text-sm text-body">{tJobs(`status_${s}`)}</span>
                <span className="text-sm font-semibold tabular-nums text-heading">
                  {statusCounts[s] ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Low stock across workshops */}
        <div className="neu p-6">
          <p className={mono("text-[10px] text-azure")}>{t("lowStockTitle")}</p>
          {lowStock.length === 0 ? (
            <p className="mt-4 text-sm text-mutedtext">{t("lowStockEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {lowStock.slice(0, 10).map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2 shadow-neu-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-heading">
                      {i.name}
                    </span>
                    <span className="block truncate text-[11px] text-mutedtext">
                      {tenantName.get(i.tenant_id) ?? "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-destructive">
                    {t("haveNeed", {
                      quantity: Number(i.quantity),
                      unit: i.unit,
                      threshold: Number(i.low_stock_threshold),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent jobs */}
      <div className="neu p-2">
        <div className="flex items-center justify-between px-4 pt-3">
          <p className={mono("text-[10px] text-azure")}>{t("recentTitle")}</p>
          <Link
            href="/design/jobs"
            className="text-xs font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("viewAllJobs")}
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-mutedtext">{t("recentEmpty")}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-borderstrong/60">
                  <Th mono={mono}>{tJobs("colTitle")}</Th>
                  <Th mono={mono}>{tJobs("colClient")}</Th>
                  <Th mono={mono}>{tJobs("colStatus")}</Th>
                  <Th mono={mono}>{tJobs("colCreated")}</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr
                    key={j.id}
                    className="border-b border-borderstrong/40 last:border-0 hover:bg-panel/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/design/jobs/${j.id}`}
                        className="font-medium text-heading hover:text-cobalt"
                      >
                        {j.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-body">
                      {tenantName.get(j.client_tenant_id) ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-[10px] font-semibold text-cobalt">
                        {tJobs(`status_${j.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-mutedtext">
                      {dateFmt.format(new Date(j.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono: (extra?: string) => string;
}) {
  return (
    <th className={cn("px-4 py-3 text-start text-[10px] font-semibold text-mutedtext", mono())}>
      {children}
    </th>
  );
}

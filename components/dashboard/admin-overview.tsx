import { getTranslations } from "next-intl/server";
import { Building2, Package, TriangleAlert } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// super_admin command center: read-only aggregates across every tenant. All
// reads go through the RLS server client (super_admin sees all rows).
//
// The jobs pipeline was retired, so the jobs KPI, the jobs-by-status panel and
// the recent-jobs table are gone. What remains is tenants + inventory health.
export async function AdminOverview({ locale }: { locale: string }) {
  const t = await getTranslations("Admin");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [tenantsRes, itemsRes] = await Promise.all([
    supabase.from("tenants").select("id, name, type"),
    supabase
      .from("inventory_items")
      .select("id, name, unit, quantity, low_stock_threshold, tenant_id"),
  ]);

  const tenants = tenantsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const tenantName = new Map(tenants.map((x) => [x.id, x.name]));

  const workshops = tenants.filter((x) => x.type === "workshop").length;
  const clients = tenants.filter((x) => x.type === "client").length;

  const lowStock = items.filter(
    (i) => i.low_stock_threshold !== null && Number(i.quantity) <= Number(i.low_stock_threshold)
  );

  const kpis = [
    {
      icon: Building2,
      label: t("tenants"),
      value: String(tenants.length),
      sub: t("tenantsBreakdown", { workshops, clients }),
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
  );
}

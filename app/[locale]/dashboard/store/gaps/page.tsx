import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, PackageSearch } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Sourcing gaps: every bill-of-materials line the store could not supply,
// grouped by function with a count of projects asking for it. The restocking
// list, written by demand. super_admin only (store layout + RLS).

export const dynamic = "force-dynamic";

type Gap = {
  function: string;
  function_key: string;
  spec: string | null;
  kind: string | null;
  quantity: number | null;
  project_id: string;
  last_seen: string;
};

export default async function SourcingGapsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SourcingGaps");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sourcing_gaps")
    .select("function, function_key, spec, kind, quantity, project_id, last_seen")
    .order("last_seen", { ascending: false })
    .limit(5000);
  const gaps = (data ?? []) as Gap[];

  const groups = new Map<string, { label: string; projects: Set<string>; specs: Set<string>; kinds: Set<string>; units: number; last: string }>();
  for (const g of gaps) {
    const e =
      groups.get(g.function_key) ??
      { label: g.function, projects: new Set<string>(), specs: new Set<string>(), kinds: new Set<string>(), units: 0, last: g.last_seen };
    e.projects.add(g.project_id);
    if (g.spec) e.specs.add(g.spec);
    if (g.kind) e.kinds.add(g.kind);
    e.units += g.quantity ?? 0;
    if (g.last_seen > e.last) e.last = g.last_seen;
    groups.set(g.function_key, e);
  }
  const rows = [...groups.values()].sort((a, b) => b.projects.size - a.projects.size || b.last.localeCompare(a.last));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/dashboard/store">
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
            {t("back")}
          </Link>
        </Button>
      </div>

      {error && <p className="mt-8 text-sm font-medium text-destructive">{t("notReady")}</p>}

      {!error && rows.length === 0 && (
        <div className="neu mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <PackageSearch className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <p className="text-sm text-mutedtext">{t("empty")}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className="px-3 pb-2 text-start font-medium">{t("colFunction")}</th>
                <th className="px-3 pb-2 text-end font-medium">{t("colProjects")}</th>
                <th className="px-3 pb-2 text-end font-medium">{t("colUnits")}</th>
                <th className="px-3 pb-2 text-start font-medium">{t("colSpecs")}</th>
                <th className="px-3 pb-2 text-end font-medium">{t("colLast")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borderstrong/40">
              {rows.map((r) => (
                <tr key={r.label} className="align-top">
                  <td className="px-3 py-2.5">
                    <span className="block font-semibold text-heading">{r.label}</span>
                    <span className="text-[11px] text-mutedtext">{[...r.kinds].map((k) => t(`kind_${k}`)).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end font-mono tabular-nums text-heading">{r.projects.size}</td>
                  <td className="px-3 py-2.5 text-end font-mono tabular-nums text-heading">{r.units}</td>
                  <td className="px-3 py-2.5 text-[12px] text-mutedtext">
                    {[...r.specs].slice(0, 3).map((s) => (
                      <span key={s} className="block">{s}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2.5 text-end text-[12px] text-mutedtext">{dateFmt.format(new Date(r.last))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

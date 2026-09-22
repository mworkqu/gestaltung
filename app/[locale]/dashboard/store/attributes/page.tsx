import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { AttributesEditor, type EditablePart } from "@/components/admin/attributes-editor";
import { isComplete, type Attributes } from "@/lib/store/attributes";
import { cn } from "@/lib/utils";

// Product attributes: the data the BOM matcher needs to match "10 kΩ, 1/4 W,
// ±5 %, through-hole" to a real product. Completeness per store category,
// because an unattributed catalogue quietly turns every match into a weak
// one. super_admin only (dashboard/store layout).

export const dynamic = "force-dynamic";

export default async function AttributesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("StoreAttributes");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [partsRes, settingRes] = await Promise.all([
    supabase
      .from("parts")
      .select("id, sku, name, name_ar, category, attributes, pack_size, is_published")
      .order("category")
      .order("sku")
      .limit(5000),
    supabase.from("store_settings").select("value").eq("key", "kit_discount_pct").maybeSingle(),
  ]);
  const parts = (partsRes.data ?? []) as EditablePart[];

  const byCategory = new Map<string, { total: number; complete: number; typed: number }>();
  for (const p of parts) {
    const c = byCategory.get(p.category) ?? { total: 0, complete: 0, typed: 0 };
    c.total += 1;
    if (isComplete(p.attributes as Attributes)) c.complete += 1;
    if ((p.attributes as Attributes | null)?.class) c.typed += 1;
    byCategory.set(p.category, c);
  }
  const overall = parts.length ? parts.filter((p) => isComplete(p.attributes as Attributes)).length / parts.length : 0;

  return (
    <div className="space-y-6">
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

      {partsRes.error && <p className="text-sm font-medium text-destructive">{t("notReady")}</p>}

      <section className="neu space-y-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-heading">{t("completeness")}</h2>
          <span className="font-mono text-sm font-bold tabular-nums text-heading">{Math.round(overall * 100)}%</span>
        </div>
        <p className="text-[12px] text-mutedtext">{t("completenessNote")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[...byCategory.entries()].map(([cat, c]) => {
            const share = c.total ? c.complete / c.total : 0;
            return (
              <li key={cat} className="space-y-1 rounded-xl bg-panel/60 p-3">
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate font-semibold text-heading">{cat}</span>
                  <span className={cn("font-mono tabular-nums", share < 1 ? "text-inventory" : "text-buy")}>
                    {c.complete}/{c.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-panel shadow-neu-inset" aria-hidden>
                  <span className="block h-full rounded-full bg-cobalt" style={{ width: `${share * 100}%` }} />
                </div>
                {c.typed < c.total && <p className="text-[10.5px] text-mutedtext">{t("untyped", { count: c.total - c.typed })}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <AttributesEditor
        locale={locale}
        parts={parts}
        kitDiscountPct={Number(settingRes.data?.value) || 0}
        settingsReady={!settingRes.error}
      />
    </div>
  );
}

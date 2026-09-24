import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { SuppliersEditor } from "@/components/admin/suppliers-editor";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

// Suppliers and sourcing settings (Task 16). super_admin only (store layout).

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Sourcing");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [suppliersRes, offersRes, settingsRes] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("supplier_offers").select("supplier_id").limit(20000),
    supabase.from("store_settings").select("key, value").in("key", ["margin_floor_pct", "fx_to_qar"]),
  ]);

  const counts: Record<string, number> = {};
  for (const o of offersRes.data ?? []) counts[o.supplier_id] = (counts[o.supplier_id] ?? 0) + 1;
  const setting = (k: string) => settingsRes.data?.find((r) => r.key === k)?.value;

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("suppliersTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("suppliersIntro")}</p>
      </div>
      {suppliersRes.error ? (
        <p className="neu p-6 text-sm text-mutedtext">{t("needsMigration")}</p>
      ) : (
        <SuppliersEditor
          locale={locale}
          suppliers={(suppliersRes.data ?? []) as Supplier[]}
          offerCounts={counts}
          floorPct={Number(setting("margin_floor_pct") ?? 15)}
          fx={(setting("fx_to_qar") as Record<string, number>) ?? { QAR: 1 }}
        />
      )}
    </div>
  );
}

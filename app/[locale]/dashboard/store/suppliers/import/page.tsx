import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { PriceListImport } from "@/components/admin/price-list-import";
import type { ColumnMapping } from "@/lib/sourcing/adapters/csv";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

// Supplier price-list import (Task 19a). super_admin only (store layout).

export const dynamic = "force-dynamic";

export default async function PriceImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PriceImport");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [suppliersRes, mappingsRes] = await Promise.all([
    supabase.from("suppliers").select("*").eq("active", true).order("name"),
    supabase.from("store_settings").select("key, value").like("key", "csv_mapping:%"),
  ]);
  const savedMappings: Record<string, ColumnMapping> = {};
  for (const r of mappingsRes.data ?? []) savedMappings[String(r.key).slice("csv_mapping:".length)] = r.value as ColumnMapping;

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <PriceListImport locale={locale} suppliers={(suppliersRes.data ?? []) as Supplier[]} savedMappings={savedMappings} />
    </div>
  );
}

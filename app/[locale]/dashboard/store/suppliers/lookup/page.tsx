import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { SupplierLookup } from "@/components/admin/supplier-lookup";
import { digikeyConfigured } from "@/lib/sourcing/adapters/digikey";
import { mouserConfigured } from "@/lib/sourcing/adapters/mouser";
import { cn } from "@/lib/utils";

// Find parts at Mouser and DigiKey (Task 19b). super_admin only (store layout).

export const dynamic = "force-dynamic";

// Suggested selling price = landed cost × (1 + this %). The owner edits it per product.
const SUGGESTED_MARKUP_PCT = 40;

export default async function SupplierLookupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SupplierLookup");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [cats, sups, fx] = await Promise.all([
    supabase.from("parts").select("category").is("merged_into", null).limit(5000),
    supabase.from("suppliers").select("code, landed_overhead_pct").in("code", ["mouser", "digikey"]),
    supabase.from("store_settings").select("value").eq("key", "fx_to_qar").maybeSingle(),
  ]);
  const categories = [...new Set((cats.data ?? []).map((r) => r.category as string))].sort();
  const overheadPct: Record<string, number> = {};
  for (const s of sups.data ?? []) overheadPct[s.code as string] = Number(s.landed_overhead_pct) || 0;
  const usdToQar = Number((fx.data?.value as Record<string, number> | null)?.USD) || 3.64;

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <SupplierLookup
        locale={locale}
        categories={categories}
        pricing={{ usdToQar, overheadPct, markup: SUGGESTED_MARKUP_PCT }}
        configured={{ mouser: mouserConfigured(), digikey: digikeyConfigured() }}
      />
    </div>
  );
}

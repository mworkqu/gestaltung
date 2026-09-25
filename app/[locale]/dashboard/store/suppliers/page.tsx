import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { SuppliersEditor } from "@/components/admin/suppliers-editor";
import {
  OfferCoverage,
  computeCoverage,
  type Coverage,
  type CoverageOffer,
  type CoveragePart,
} from "@/components/admin/offer-coverage";
import { ShippingSettingsEditor } from "@/components/admin/shipping-settings";
import type { ShippingSettings } from "@/app/[locale]/dashboard/store/sourcing/actions";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

// Suppliers and sourcing settings (Task 16). super_admin only (store layout).

export const dynamic = "force-dynamic";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type PgError = { code?: string } | null;

// PostgREST caps a response at 1000 rows regardless of .limit(), so page
// through with .range(). Returns the error instead of a partial list.
const PAGE = 1000;
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>
): Promise<{ rows: T[]; error: PgError }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) return { rows: [], error };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, error: null };
  }
}

// Published products that customers can see. merged_into arrives in migration
// 0030; before that the column doesn't exist (Postgres 42703), so retry
// without the filter.
async function loadPublishedParts(supabase: Supabase) {
  const withMerged = await fetchAll<CoveragePart>((from, to) =>
    supabase
      .from("parts")
      .select("id, name, name_ar")
      .eq("is_published", true)
      .is("merged_into", null)
      .order("name")
      .order("id")
      .range(from, to)
  );
  if (withMerged.error?.code !== "42703") return withMerged;
  return fetchAll<CoveragePart>((from, to) =>
    supabase
      .from("parts")
      .select("id, name, name_ar")
      .eq("is_published", true)
      .order("name")
      .order("id")
      .range(from, to)
  );
}

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Sourcing");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [suppliersRes, offersRes, partsRes, settingsRes] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    fetchAll<CoverageOffer>((from, to) =>
      supabase.from("supplier_offers").select("part_id, supplier_id, active").order("id").range(from, to)
    ),
    loadPublishedParts(supabase),
    supabase.from("store_settings").select("key, value").in("key", ["margin_floor_pct", "fx_to_qar", "shipping"]),
  ]);

  const suppliers = (suppliersRes.data ?? []) as Supplier[];
  const counts: Record<string, number> = {};
  for (const o of offersRes.rows) counts[o.supplier_id] = (counts[o.supplier_id] ?? 0) + 1;
  const setting = (k: string) => settingsRes.data?.find((r) => r.key === k)?.value;

  const coverage: Coverage | null =
    offersRes.error || partsRes.error
      ? null
      : computeCoverage(
          offersRes.rows,
          new Set(suppliers.filter((s) => s.active).map((s) => s.id)),
          partsRes.rows
        );

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
        <>
          <OfferCoverage coverage={coverage} locale={locale} />
          <SuppliersEditor
            locale={locale}
            suppliers={suppliers}
            offerCounts={offersRes.error ? null : counts}
            floorPct={Number(setting("margin_floor_pct") ?? 15)}
            fx={(setting("fx_to_qar") as Record<string, number>) ?? { QAR: 1 }}
          />
        </>
      )}
      {Boolean(setting("shipping")) && (
        <ShippingSettingsEditor locale={locale} initial={setting("shipping") as ShippingSettings} />
      )}
    </div>
  );
}

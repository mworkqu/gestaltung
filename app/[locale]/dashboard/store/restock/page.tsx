import { getTranslations, setRequestLocale } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { RestockDashboard, type SummaryExtras } from "@/components/admin/restock-dashboard";
import { cleanWeights, demandScore, estimatedUnits, type RestockRow, type SignalCounts } from "@/lib/store/restock";
import { cn } from "@/lib/utils";

// Restock dashboard (Task 20): what to order next, ranked by open demand.
// super_admin only (store layout).

export const dynamic = "force-dynamic";

type SummaryProduct = { part_id: string; views: number; carts: number; requests: number; requested_qty: number; last_signal: string };

export default async function RestockPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Restock");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const [summaryRes, weightsRes] = await Promise.all([
    supabase.rpc("restock_summary"),
    supabase.from("store_settings").select("value").eq("key", "restock_weights").maybeSingle(),
  ]);
  if (summaryRes.error) {
    return <p className="neu p-6 text-sm text-mutedtext">{t("needsMigration")}</p>;
  }
  const weights = cleanWeights(weightsRes.data?.value as Record<string, unknown> | null);
  const summary = summaryRes.data as {
    products: SummaryProduct[];
    searches: SummaryExtras["searches"];
    bom: SummaryExtras["bom"];
    receipts: SummaryExtras["receipts"];
  };

  // Product, preferred offer and supplier for every product with open demand.
  const ids = summary.products.map((p) => p.part_id);
  const parts: {
    id: string;
    sku: string;
    name: string;
    unit_price: number;
    landed_cost_qar: number | null;
    expected_income_qar: number | null;
    income_pct: number | null;
    lead_time_class: string | null;
    preferred_offer_id: string | null;
  }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("parts")
      .select("id, sku, name, unit_price, landed_cost_qar, expected_income_qar, income_pct, lead_time_class, preferred_offer_id")
      .in("id", ids.slice(i, i + 200));
    parts.push(...((data ?? []) as typeof parts));
  }
  const offerIds = parts.map((p) => p.preferred_offer_id).filter((x): x is string => !!x);
  const { data: offers } = offerIds.length
    ? await supabase.from("supplier_offers").select("id, supplier_id, supplier_sku, supplier_url, moq").in("id", offerIds)
    : { data: [] };
  const { data: suppliers } = await supabase.from("suppliers").select("id, name, min_order_value_qar");
  const offerById = new Map((offers ?? []).map((o) => [o.id as string, o]));
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id as string, s]));
  const partById = new Map(parts.map((p) => [p.id, p]));

  const rows: RestockRow[] = summary.products
    .map((s) => {
      const p = partById.get(s.part_id);
      if (!p) return null;
      const counts: SignalCounts = { views: Number(s.views), carts: Number(s.carts), requests: Number(s.requests), requestedQty: Number(s.requested_qty) };
      const o = p.preferred_offer_id ? offerById.get(p.preferred_offer_id) : undefined;
      const sup = o ? supplierById.get(o.supplier_id as string) : undefined;
      const units = estimatedUnits(counts);
      return {
        partId: p.id,
        sku: p.sku,
        name: p.name,
        counts,
        score: demandScore(counts, weights),
        price: Number(p.unit_price),
        landedCost: p.landed_cost_qar === null ? null : Number(p.landed_cost_qar),
        income: p.expected_income_qar === null ? null : Number(p.expected_income_qar),
        incomePct: p.income_pct === null ? null : Number(p.income_pct),
        leadTimeClass: p.lead_time_class,
        supplier: sup ? { id: sup.id as string, name: sup.name as string, minOrderValue: sup.min_order_value_qar === null ? null : Number(sup.min_order_value_qar) } : null,
        supplierSku: (o?.supplier_sku as string | null) ?? null,
        supplierUrl: (o?.supplier_url as string | null) ?? null,
        moq: Number(o?.moq ?? 1),
        units,
        estRevenue: Math.round(units * Number(p.unit_price) * 100) / 100,
      } satisfies RestockRow;
    })
    .filter((r): r is RestockRow => !!r)
    .sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <RestockDashboard
        locale={locale}
        rows={rows}
        weights={weights}
        extras={{ searches: summary.searches, bom: summary.bom, receipts: summary.receipts }}
        bomWeight={weights.bom_unmatched}
      />
    </div>
  );
}

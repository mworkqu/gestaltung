import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import type { Part } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/server";
import { PartForm } from "@/components/parts/part-form";
import { SourcingPanel } from "@/components/admin/sourcing-panel";
import type { PartSourcing, Supplier, SupplierOffer } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditPartPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase.from("parts").select("*").eq("id", id).maybeSingle();
  const part = data as Part | null;
  if (!part) notFound();

  // Sourcing (0028). If the migration hasn't run, the suppliers query errors
  // and the panel is replaced by a notice.
  const [suppliersRes, offersRes, floorRes] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("supplier_offers").select("*").eq("part_id", id).order("created_at"),
    supabase.from("store_settings").select("value").eq("key", "margin_floor_pct").maybeSingle(),
  ]);
  const sourcingReady = !suppliersRes.error && !offersRes.error;
  const offers = (offersRes.data ?? []) as SupplierOffer[];
  const landed = await Promise.all(
    offers.map(async (o) => {
      const { data: v } = await supabase.rpc("offer_landed_cost_qar", { p_offer_id: o.id });
      return { ...o, landed_qar: v === null || v === undefined ? null : Number(v) };
    })
  );
  const tSourcing = await getTranslations("Sourcing");

  return (
    <div className="mx-auto max-w-5xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("editTitle")}</h1>
      <div className="neu mt-8 max-w-2xl p-6 sm:p-8">
        <PartForm mode="edit" part={part} />
      </div>
      <div className="neu mt-8 p-6 sm:p-8">
        {sourcingReady ? (
          <SourcingPanel
            locale={locale}
            partId={part.id}
            unitPrice={part.unit_price}
            sourcing={part as unknown as PartSourcing}
            offers={landed}
            suppliers={(suppliersRes.data ?? []) as Supplier[]}
            floorPct={Number(floorRes.data?.value ?? 15)}
          />
        ) : (
          <p className="text-sm text-mutedtext">{tSourcing("needsMigration")}</p>
        )}
      </div>
    </div>
  );
}

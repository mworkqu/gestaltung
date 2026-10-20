import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import type { Part } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/server";
import { PartEditor } from "@/components/admin/part-editor";
import { SourcingPanel } from "@/components/admin/sourcing-panel";
import { readFloors, type PartSourcing, type Supplier, type SupplierOffer } from "@/lib/store/sourcing";
import { loadOnRequest } from "@/lib/admin/fix-data";
import { hasGalleryPhoto, partMissing } from "@/lib/admin/part-missing";
import { safeReturnTo } from "@/lib/admin/return-to";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditPartPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // D1: where Save / Cancel go back to (Fix list, catalog, restock, stock).
  const raw = (await searchParams).returnTo;
  const returnTo = safeReturnTo(Array.isArray(raw) ? raw[0] : raw, locale);

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
  const [suppliersRes, offersRes, floorRes, onRequest] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("supplier_offers").select("*").eq("part_id", id).order("created_at"),
    supabase.from("store_settings").select("key, value").in("key", ["margin_floor_pct", "commission_floor_pct"]),
    loadOnRequest(supabase),
  ]);
  const sourcingReady = !suppliersRes.error && !offersRes.error;
  // Two floors: our margin on parts we price, the supplier's commission on
  // mirror parts (migration 0098).
  const floorRow = (k: string) => floorRes.data?.find((r) => r.key === k)?.value;
  const floors = readFloors(floorRow("margin_floor_pct"), floorRow("commission_floor_pct"));
  const offers = (offersRes.data ?? []) as SupplierOffer[];
  const landed = await Promise.all(
    offers.map(async (o) => {
      const { data: v } = await supabase.rpc("offer_landed_cost_qar", { p_offer_id: o.id });
      return { ...o, landed_qar: v === null || v === undefined ? null : Number(v) };
    })
  );
  const tSourcing = await getTranslations("Sourcing");

  const deliveryMissing = !part.lead_time_class && !onRequest?.has(part.id);
  const initialMissing = partMissing({
    name: part.name,
    sku: part.sku,
    category: part.category,
    unit_price: part.unit_price,
    image_url: part.image_url,
    hasGalleryPhoto: hasGalleryPhoto((part as { images?: unknown }).images),
    deliveryMissing,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("editTitle")}</h1>
      <PartEditor
        part={part}
        returnTo={returnTo}
        deliveryMissing={deliveryMissing}
        initialMissing={initialMissing}
        delivery={
          sourcingReady ? (
            <SourcingPanel
              locale={locale}
              partId={part.id}
              unitPrice={part.unit_price}
              sourcing={part as unknown as PartSourcing}
              offers={landed}
              suppliers={(suppliersRes.data ?? []) as Supplier[]}
              floors={floors}
            />
          ) : (
            <p className="text-sm text-mutedtext">{tSourcing("needsMigration")}</p>
          )
        }
      />
    </div>
  );
}

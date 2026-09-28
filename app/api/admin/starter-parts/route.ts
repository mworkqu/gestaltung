import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { digikeySearch } from "@/lib/sourcing/adapters/digikey";
import { parametersToAttributes } from "@/lib/sourcing/spec-map";
import { fetchImage, storeImage } from "@/lib/store/store-image";

// One-off starter set (owner, 2026-09-28): standard components Voltaat doesn't
// sell individually, from DigiKey's official API. One search call per item.
// Names are ours; photo, specs, cost and lead time come from DigiKey. Sold in
// packs where a single piece makes no sense. Skips anything already in the
// store, so running it again adds nothing. super_admin only.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STARTERS: { q: string; name: string; category: string; pack: number }[] = [
  { q: "CF14JT220R", name: "Resistor 220 Ω 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "CF14JT1K00", name: "Resistor 1 kΩ 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "CF14JT10K0", name: "Resistor 10 kΩ 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "CF14JT100K", name: "Resistor 100 kΩ 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "FG18X7R1H104KNT06", name: "Ceramic capacitor 100 nF 50 V (pack of 10)", category: "Components", pack: 10 },
  { q: "ECA-1HM100", name: "Electrolytic capacitor 10 µF 50 V (pack of 10)", category: "Components", pack: 10 },
  { q: "ECA-1HM101", name: "Electrolytic capacitor 100 µF 50 V (pack of 10)", category: "Components", pack: 10 },
  { q: "1N4007-T", name: "Rectifier diode 1N4007 1 A 1000 V (pack of 10)", category: "Components", pack: 10 },
  { q: "1N5819-T", name: "Schottky diode 1N5819 1 A 40 V (pack of 10)", category: "Components", pack: 10 },
  { q: "ECS-160-20-4X", name: "Crystal 16 MHz HC-49", category: "Components", pack: 1 },
  { q: "LM358P", name: "LM358 dual op-amp, DIP-8", category: "Chips & ICs", pack: 1 },
  { q: "M3 hex nut stainless steel", name: "Hex nut M3, stainless steel (pack of 10)", category: "Fasteners", pack: 10 },
  { q: "M3 flat washer stainless steel", name: "Flat washer M3, stainless steel (pack of 10)", category: "Fasteners", pack: 10 },
];

const IMAGE_HOSTS = /(^|\.)(digikey\.com)$/i;
const MARKUP = 1.4;

export async function POST() {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const supabase = await createClient();

  const { data: sup } = await supabase.from("suppliers").select("id, landed_overhead_pct").eq("code", "digikey").single();
  const { data: fxRow } = await supabase.from("store_settings").select("value").eq("key", "fx_to_qar").maybeSingle();
  const usd = Number((fxRow?.value as Record<string, number> | null)?.USD) || 3.64;
  const overhead = 1 + (Number(sup?.landed_overhead_pct) || 0) / 100;

  const results: { name: string; status: string; sku?: string; price?: number }[] = [];
  let calls = 0;
  for (const s of STARTERS) {
    const { data: exists } = await supabase.from("parts").select("id").ilike("name", s.name).is("merged_into", null).limit(1);
    if (exists?.length) {
      results.push({ name: s.name, status: "already_in_store" });
      continue;
    }
    calls++;
    const hits = await digikeySearch(s.q, 1).catch(() => []);
    const r = hits[0];
    if (!r || r.cost === null) {
      results.push({ name: s.name, status: "not_found" });
      continue;
    }
    const landedPerPack = r.cost * usd * overhead * s.pack;
    const price = Math.max(2, Math.ceil(landedPerPack * MARKUP * 2) / 2);
    const attrs = parametersToAttributes(r.parameters, { category: r.category, description: r.description });
    const { data: part, error } = await supabase
      .from("parts")
      .insert({
        sku: `DK-${r.supplierSku.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`,
        name: s.name,
        description: [r.description, r.manufacturer && r.mpn ? `Manufacturer part: ${r.manufacturer} ${r.mpn}` : null, r.datasheetUrl ? `Datasheet: ${r.datasheetUrl}` : null]
          .filter(Boolean)
          .join("\n"),
        category: s.category,
        unit_price: price,
        pack_size: s.pack,
        min_order_qty: 1,
        stock_status: "in_stock",
        is_published: true,
        attributes: attrs,
        pricing_mode: "markup",
      })
      .select("id, sku")
      .single();
    if (error || !part) {
      results.push({ name: s.name, status: `insert_failed: ${error?.message ?? ""}`.slice(0, 120) });
      continue;
    }
    await supabase.from("supplier_offers").insert({
      part_id: part.id,
      supplier_id: sup!.id,
      supplier_sku: r.supplierSku,
      supplier_url: r.url,
      cost: r.cost,
      currency: r.currency,
      pack_size: 1,
      moq: r.moq,
      availability: r.availability,
      lead_time_days: r.leadTimeDays,
      last_checked_at: new Date().toISOString(),
    });
    if (r.imageUrl) {
      try {
        const buf = await fetchImage(r.imageUrl, IMAGE_HOSTS);
        if (buf) {
          const img = await storeImage(supabase, buf, `supplier/digikey/${part.id}/${Date.now()}`);
          await supabase.from("parts").update({ images: [img], image_url: img.web }).eq("id", part.id);
        }
      } catch {
        // The product stands without a photo.
      }
    }
    results.push({ name: s.name, status: "added", sku: part.sku, price });
  }
  return Response.json({ calls, results });
}

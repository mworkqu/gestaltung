import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { digikeySearch } from "@/lib/sourcing/adapters/digikey";
import { mouserSearch } from "@/lib/sourcing/adapters/mouser";
import { parametersToAttributes } from "@/lib/sourcing/spec-map";
import { fetchImage, storeImage } from "@/lib/store/store-image";

// One-off starter set (owner, 2026-09-28): standard components Voltaat doesn't
// sell individually, from DigiKey's and Mouser's official APIs (2026-09-29:
// a mix of both, owner). One search call per item, once — never repeated.
// Names are ours; photo, specs, cost and lead time come from DigiKey. Sold in
// packs where a single piece makes no sense. Skips anything already in the
// store, so running it again adds nothing. super_admin only.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Via = "digikey" | "mouser";
const STARTERS: { q: string; name: string; category: string; pack: number; via?: Via }[] = [
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
  // 2026-09-29: more parts Voltaat doesn't list, split between DigiKey and Mouser.
  { q: "CF14JT330R", name: "Resistor 330 Ω 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "CF14JT4K70", name: "Resistor 4.7 kΩ 1/4 W, through-hole (pack of 10)", category: "Components", pack: 10 },
  { q: "ECA-1EM471", name: "Electrolytic capacitor 470 µF 25 V (pack of 5)", category: "Components", pack: 5 },
  { q: "1N4148-T", name: "Signal diode 1N4148 (pack of 10)", category: "Components", pack: 10 },
  { q: "LM1117T-3.3/NOPB", name: "LM1117 3.3 V LDO regulator, TO-220", category: "Chips & ICs", pack: 1 },
  { q: "MCP3008-I/P", name: "MCP3008 8-channel 10-bit ADC, DIP-16", category: "Chips & ICs", pack: 1 },
  { q: "PC817X2NSZ9F", name: "PC817 optocoupler, DIP-4 (pack of 5)", category: "Chips & ICs", pack: 5 },
  { q: "CD4051BE", name: "CD4051 8-channel analog multiplexer, DIP-16", category: "Chips & ICs", pack: 1 },
  { q: "NE555P", name: "NE555 timer IC, DIP-8", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "L7805CV", name: "L7805 5 V voltage regulator, TO-220", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "LM317T", name: "LM317 adjustable voltage regulator, TO-220", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "ULN2003AN", name: "ULN2003 Darlington driver array, DIP-16", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "SN74HC595N", name: "74HC595 shift register, DIP-16", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "ATMEGA328P-PU", name: "ATmega328P microcontroller, DIP-28", category: "Microcontrollers", pack: 1, via: "mouser" },
  { q: "L293DNE", name: "L293D dual H-bridge motor driver, DIP-16", category: "Chips & ICs", pack: 1, via: "mouser" },
  { q: "BC547BTA", name: "BC547 NPN transistor (pack of 10)", category: "Components", pack: 10, via: "mouser" },
  { q: "IRLZ44NPBF", name: "IRLZ44N logic-level N-MOSFET, TO-220", category: "Components", pack: 1, via: "mouser" },
  { q: "2N2222A", name: "2N2222A NPN transistor, TO-92 (pack of 10)", category: "Components", pack: 10, via: "mouser" },
];

const IMAGE_HOSTS = /(^|\.)(digikey\.com|mouser\.com)$/i;
const MARKUP = 1.4;

export async function POST() {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const supabase = await createClient();

  const { data: sups } = await supabase.from("suppliers").select("id, code, landed_overhead_pct").in("code", ["digikey", "mouser"]);
  const supplier = (via: Via) => sups?.find((s) => s.code === via);
  const { data: fxRow } = await supabase.from("store_settings").select("value").eq("key", "fx_to_qar").maybeSingle();
  const usd = Number((fxRow?.value as Record<string, number> | null)?.USD) || 3.64;

  const results: { name: string; status: string; sku?: string; price?: number }[] = [];
  let calls = 0;
  for (const s of STARTERS) {
    const { data: exists } = await supabase.from("parts").select("id").ilike("name", s.name).is("merged_into", null).limit(1);
    if (exists?.length) {
      results.push({ name: s.name, status: "already_in_store" });
      continue;
    }
    const via: Via = s.via ?? "digikey";
    const sup = supplier(via);
    if (!sup) {
      results.push({ name: s.name, status: `no_${via}_supplier` });
      continue;
    }
    const overhead = 1 + (Number(sup.landed_overhead_pct) || 0) / 100;
    // Mouser allows 30 calls a minute.
    if (via === "mouser" && calls) await new Promise((r) => setTimeout(r, 2100));
    calls++;
    const hits = await (via === "mouser" ? mouserSearch(s.q, 1) : digikeySearch(s.q, 1)).catch(() => []);
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
        sku: `${via === "mouser" ? "MS" : "DK"}-${r.supplierSku.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`,
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
      supplier_id: sup.id,
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
          const img = await storeImage(supabase, buf, `supplier/${via}/${part.id}/${Date.now()}`);
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

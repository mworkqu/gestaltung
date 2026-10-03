import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { partKey } from "@/lib/parts/part-key";
import { BlockedError, handleFromUrl, robotsAllows, variantFromUrl, VoltaatClient } from "@/lib/sourcing/adapters/voltaat";
import { buildImportRows } from "@/lib/sourcing/voltaat-catalogue";
import { revalidateStorefront } from "@/lib/cache/storefront";

// Import Voltaat's catalogue into our store (owner decision 2026-09-28).
// Reads the public catalogue once (robots.txt checked, 5 s between requests),
// then creates a mirror-priced product + Voltaat offer for every option we
// don't already follow. Re-running only adds what's new. super_admin only.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { publish?: boolean };
  const supabase = await createClient();

  const { data: sup } = await supabase.from("suppliers").select("id").eq("code", "voltaat").single();
  if (!sup) return Response.json({ error: "no_voltaat_supplier" }, { status: 500 });

  // What we already follow, and product identities we already sell.
  const mappedKeys = new Set<string>();
  const existingPartKeys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("supplier_offers").select("supplier_url").eq("supplier_id", sup.id).range(from, from + 999);
    for (const o of data ?? []) {
      const h = handleFromUrl(o.supplier_url as string | null);
      if (h) mappedKeys.add(`${h}|${variantFromUrl(o.supplier_url as string) ?? "*"}`);
    }
    if ((data ?? []).length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("parts").select("name, material, pack_size").is("merged_into", null).range(from, from + 999);
    for (const p of data ?? []) existingPartKeys.add(partKey(p.name as string, p.material as string | null, p.pack_size as number | null));
    if ((data ?? []).length < 1000) break;
  }

  const client = new VoltaatClient();
  let raw;
  try {
    const robots = await client.robots();
    if (!robotsAllows(robots, "/products.json?limit=250&page=1")) return Response.json({ error: "robots_disallow" }, { status: 409 });
    raw = await client.rawCatalogue();
  } catch (e) {
    return Response.json({ error: e instanceof BlockedError ? e.message : "fetch_failed", requests: client.requests }, { status: 502 });
  }

  const { rows, skippedMapped, skippedDuplicate } = buildImportRows(raw, {
    mappedKeys,
    existingPartKeys,
    publish: body.publish !== false,
  });

  let created = 0;
  let failed = 0;
  const partIdBySku = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { data, error } = await supabase.from("parts").insert(chunk.map((r) => r.part)).select("id, sku");
    if (!error) {
      for (const p of data ?? []) partIdBySku.set(p.sku as string, p.id as string);
      continue;
    }
    // A clash inside the chunk (e.g. a name added meanwhile): insert one by one, skip the clashes.
    for (const r of chunk) {
      const { data: one } = await supabase.from("parts").insert(r.part).select("id, sku").maybeSingle();
      if (one) partIdBySku.set(one.sku as string, one.id as string);
      else failed++;
    }
  }

  const offers = rows
    .filter((r) => partIdBySku.has(r.part.sku))
    .map((r) => ({ ...r.offer, part_id: partIdBySku.get(r.part.sku)!, supplier_id: sup.id, last_checked_at: new Date().toISOString() }));
  for (let i = 0; i < offers.length; i += 200) {
    const { error } = await supabase.from("supplier_offers").insert(offers.slice(i, i + 200));
    if (error) failed += Math.min(200, offers.length - i);
    else created += Math.min(200, offers.length - i);
  }

  revalidateStorefront();
  return Response.json({
    requests: client.requests,
    products: raw.length,
    created,
    skippedMapped,
    skippedDuplicate,
    failed,
  });
}

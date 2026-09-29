import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { digikeyPart, digikeySearch } from "@/lib/sourcing/adapters/digikey";
import { mouserPart, mouserSearch } from "@/lib/sourcing/adapters/mouser";
import { backupName, isComponent, modelCodes, pickBackup } from "@/lib/sourcing/backup";
import { parametersToAttributes } from "@/lib/sourcing/spec-map";
import { fetchImage, storeImage } from "@/lib/store/store-image";
import type { SupplierProduct } from "@/lib/sourcing/types";

// DigiKey / Mouser backups and datasheets (owner, 2026-09-29). super_admin.
// POST { step }:
//  - "backups": for each Voltaat product with no stock (no delivery date), look
//    up its model code at DigiKey, then Mouser. The same model becomes a new
//    store product (backup_for = the Voltaat product) with the supplier's
//    photo, price, specs and datasheet. Each Voltaat product is searched once
//    (store_settings.backup_search); call again until `remaining` is 0.
//    { preview: true } finds matches and returns them WITHOUT creating anything
//    or marking products as searched — check the pairs first.
//  - "clear": delete every backup product and forget which were searched.
//  - "specs": fill specs + datasheet on our DigiKey / Mouser products (one
//    lookup each, once).
// Needs migration 0041.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MARKUP = 1.4;
const BUDGET_MS = 230_000;
const IMAGE_HOSTS = /(^|\.)(digikey\.com)$/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Db = Awaited<ReturnType<typeof createClient>>;

async function settings(db: Db) {
  const { data: sups } = await db.from("suppliers").select("id, code, landed_overhead_pct").in("code", ["digikey", "mouser"]);
  const { data: fxRow } = await db.from("store_settings").select("value").eq("key", "fx_to_qar").maybeSingle();
  const fx = (fxRow?.value ?? {}) as Record<string, number>;
  return { sups: sups ?? [], fx };
}

function specsOf(p: SupplierProduct) {
  return p.parameters.filter((x) => x.name && x.value && x.value !== "-").slice(0, 40);
}

async function clear(db: Db) {
  const { data } = await db.from("parts").select("id").not("backup_for", "is", null);
  const ids = (data ?? []).map((p) => p.id as string);
  let deleted = 0;
  let unpublished = 0;
  for (const id of ids) {
    const { error } = await db.from("parts").delete().eq("id", id);
    if (!error) deleted++;
    else {
      await db.from("parts").update({ is_published: false, backup_for: null }).eq("id", id);
      unpublished++;
    }
  }
  await db.from("store_settings").upsert({ key: "backup_search", value: { checked: {} } });
  return { deleted, unpublished };
}

async function backups(db: Db, preview: boolean) {
  const started = Date.now();
  const { sups, fx } = await settings(db);
  const { data: state } = await db.from("store_settings").select("value").eq("key", "backup_search").maybeSingle();
  const checked: Record<string, string> = ((state?.value ?? {}) as { checked?: Record<string, string> }).checked ?? {};

  const { rows: waiting } = await fetchAllRows<{ id: string; name: string; category: string | null }>((from, to) =>
    db
      .from("parts")
      .select("id, name, category")
      .like("sku", "VLT-%")
      .eq("is_published", true)
      .is("merged_into", null)
      .is("lead_time_class", null)
      .order("id")
      .range(from, to)
  );
  const { rows: existing } = await fetchAllRows<{ backup_for: string }>((from, to) =>
    db.from("parts").select("backup_for").not("backup_for", "is", null).order("id").range(from, to)
  );
  const hasBackup = new Set(existing.map((e) => e.backup_for));
  const todo = waiting.filter((p) => !checked[p.id] && !hasBackup.has(p.id));

  let added = 0;
  let assembly = 0;
  let noModel = 0;
  const pairs: { voltaat: string; code: string; match: string; mpn: string | null; supplier: string }[] = [];
  let notFound = 0;
  let calls = 0;
  const addedNames: string[] = [];
  for (const p of todo) {
    if (Date.now() - started > BUDGET_MS) break;
    if (!isComponent(p.name)) {
      if (!preview) checked[p.id] = "assembly";
      assembly++;
      continue;
    }
    const codes = modelCodes(p.name).slice(0, 2);
    if (!codes.length) {
      if (!preview) checked[p.id] = "no_model";
      noModel++;
      continue;
    }
    let hit: SupplierProduct | null = null;
    let usedCode = "";
    for (const code of codes) {
      usedCode = code;
      calls++;
      hit = pickBackup(await digikeySearch(code, 10).catch(() => []), code, p.name);
      await wait(600);
      if (hit) break;
      calls++;
      hit = pickBackup(await mouserSearch(code, 10).catch(() => []), code, p.name);
      await wait(2100);
      if (hit) break;
    }
    if (!hit) {
      if (!preview) checked[p.id] = "not_found";
      notFound++;
      continue;
    }
    pairs.push({ voltaat: p.name, code: usedCode, match: backupName(hit), mpn: hit.mpn, supplier: hit.supplierCode });
    if (preview) continue;
    const sup = sups.find((s) => s.code === hit!.supplierCode);
    if (!sup) continue;
    const rate = Number(fx[hit.currency]) || (hit.currency === "QAR" ? 1 : 3.64);
    const landed = hit.cost! * rate * (1 + (Number(sup.landed_overhead_pct) || 0) / 100);
    const price = Math.max(2, Math.ceil(landed * MARKUP * 2) / 2);
    const { data: part, error } = await db
      .from("parts")
      .insert({
        sku: `${hit.supplierCode === "mouser" ? "MS" : "DK"}-${hit.supplierSku.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`,
        name: backupName(hit),
        description: [hit.description, hit.manufacturer && hit.mpn ? `Manufacturer part: ${hit.manufacturer} ${hit.mpn}` : null]
          .filter(Boolean)
          .join("\n"),
        category: p.category ?? "Components",
        unit_price: price,
        min_order_qty: 1,
        stock_status: "in_stock",
        is_published: true,
        pricing_mode: "markup",
        attributes: parametersToAttributes(hit.parameters, { category: hit.category, description: hit.description }),
        specs: specsOf(hit),
        datasheet_url: hit.datasheetUrl,
        backup_for: p.id,
      })
      .select("id")
      .single();
    if (error || !part) {
      // A DigiKey product we already sell under another name: nothing to add.
      checked[p.id] = "exists";
      continue;
    }
    await db.from("supplier_offers").insert({
      part_id: part.id,
      supplier_id: sup.id,
      supplier_sku: hit.supplierSku,
      supplier_url: hit.url,
      cost: hit.cost,
      currency: hit.currency,
      pack_size: 1,
      moq: hit.moq,
      availability: hit.availability,
      lead_time_days: hit.leadTimeDays,
      last_checked_at: new Date().toISOString(),
    });
    if (hit.imageUrl && hit.supplierCode === "digikey") {
      try {
        const buf = await fetchImage(hit.imageUrl, IMAGE_HOSTS);
        if (buf) {
          const img = await storeImage(db, buf, `supplier/digikey/${part.id}/${Date.now()}`);
          await db.from("parts").update({ images: [img], image_url: img.web }).eq("id", part.id);
        }
      } catch {
        // The product stands without a photo.
      }
    }
    checked[p.id] = "added";
    added++;
    addedNames.push(backupName(hit).slice(0, 60));
  }

  if (!preview) await db.from("store_settings").upsert({ key: "backup_search", value: { checked } });
  const remaining = todo.filter((p) => !checked[p.id]).length;
  return { preview, added, assembly, noModel, notFound, calls, remaining, pairs, addedNames };
}

async function specs(db: Db) {
  const started = Date.now();
  const { data } = await db
    .from("parts")
    .select("id, sku, description")
    .or("sku.like.DK-%,sku.like.MS-%")
    .is("specs", null)
    .limit(60);
  const { data: offers } = await db
    .from("supplier_offers")
    .select("part_id, supplier_sku, suppliers(code)")
    .in("part_id", (data ?? []).map((p) => p.id as string));
  let filled = 0;
  for (const p of data ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    const o = (offers ?? []).find((x) => x.part_id === p.id) as { supplier_sku: string; suppliers: { code: string } | null } | undefined;
    if (!o?.supplier_sku) continue;
    const mouser = o.suppliers?.code === "mouser";
    const hit = await (mouser ? mouserPart(o.supplier_sku) : digikeyPart(o.supplier_sku)).catch(() => null);
    await wait(mouser ? 2100 : 600);
    if (!hit) {
      await db.from("parts").update({ specs: [] }).eq("id", p.id);
      continue;
    }
    await db.from("parts").update({ specs: specsOf(hit), datasheet_url: hit.datasheetUrl }).eq("id", p.id);
    filled++;
  }
  return { filled };
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const { step, preview } = (await request.json().catch(() => ({}))) as { step?: string; preview?: boolean };
  const db = await createClient();
  const { error } = await db.from("parts").select("backup_for").limit(1);
  if (error) return Response.json({ error: "run_migration_0041" }, { status: 409 });
  if (step === "backups") return Response.json(await backups(db, preview === true));
  if (step === "clear") return Response.json(await clear(db));
  if (step === "specs") return Response.json(await specs(db));
  return Response.json({ error: "unknown_step" }, { status: 400 });
}

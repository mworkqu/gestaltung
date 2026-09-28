import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { handleFromUrl } from "@/lib/sourcing/adapters/voltaat";
import { optionsNote } from "@/lib/sourcing/voltaat-catalogue";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";

// Store clean-up (owner, 2026-09-29). super_admin only. POST { step }:
//  - "dedupe": the Voltaat import made one product per option (CW / CCW
//    thruster…), which read as duplicates. Keep one product per Voltaat
//    product (the option in stock, else the first), name it by the product,
//    list the options in its description, delete the rest.
//  - "placeholders": delete the old sample products (SKU 123, GR-…).
//  - "translate": Arabic names for published products that have none, via
//    Gemini in batches. Call again until `remaining` is 0.
// A product an order or project still points at can't be deleted; it is
// unpublished (and merged into the kept product) instead.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Db = Awaited<ReturnType<typeof createClient>>;

async function removeParts(db: Db, ids: string[], mergeInto?: Map<string, string>) {
  let deleted = 0;
  let unpublished = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error } = await db.from("parts").delete().in("id", chunk);
    if (!error) {
      deleted += chunk.length;
      continue;
    }
    for (const id of chunk) {
      const { error: one } = await db.from("parts").delete().eq("id", id);
      if (!one) {
        deleted++;
        continue;
      }
      await db
        .from("parts")
        .update({ is_published: false, ...(mergeInto?.get(id) ? { merged_into: mergeInto.get(id) } : {}) })
        .eq("id", id);
      unpublished++;
    }
  }
  return { deleted, unpublished };
}

async function dedupe(db: Db) {
  const { data: sup } = await db.from("suppliers").select("id").eq("code", "voltaat").single();
  if (!sup) return { error: "no_voltaat_supplier" };
  const { rows: offers } = await fetchAllRows<{ part_id: string; supplier_url: string | null; active: boolean }>((from, to) =>
    db.from("supplier_offers").select("part_id, supplier_url, active").eq("supplier_id", sup.id).order("id").range(from, to)
  );
  const { rows: parts } = await fetchAllRows<{ id: string; sku: string; name: string; description: string | null; merged_into: string | null }>(
    (from, to) => db.from("parts").select("id, sku, name, description, merged_into").like("sku", "VLT-%").order("sku").range(from, to)
  );
  const partById = new Map(parts.filter((p) => !p.merged_into).map((p) => [p.id, p]));

  const groups = new Map<string, { id: string; active: boolean }[]>();
  for (const o of offers) {
    const h = handleFromUrl(o.supplier_url);
    if (!h || !partById.has(o.part_id)) continue;
    const g = groups.get(h) ?? [];
    if (!g.some((x) => x.id === o.part_id)) g.push({ id: o.part_id, active: o.active });
    groups.set(h, g);
  }

  const losers: string[] = [];
  const mergeInto = new Map<string, string>();
  let renamed = 0;
  let groupsMerged = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    groupsMerged++;
    g.sort((a, b) => Number(b.active) - Number(a.active) || partById.get(a.id)!.sku.localeCompare(partById.get(b.id)!.sku));
    const keep = partById.get(g[0].id)!;
    const cut = (n: string) => (n.lastIndexOf(" — ") > 0 ? n.slice(0, n.lastIndexOf(" — ")) : n);
    const option = (n: string) => (n.lastIndexOf(" — ") > 0 ? n.slice(n.lastIndexOf(" — ") + 3) : "");
    const options = g.map((x) => option(partById.get(x.id)!.name)).filter(Boolean);
    for (const x of g.slice(1)) {
      losers.push(x.id);
      mergeInto.set(x.id, keep.id);
    }
    // Delete the others first so the product name is free.
    await removeParts(db, g.slice(1).map((x) => x.id), mergeInto);
    const base = cut(keep.name);
    const note = options.length > 1 ? optionsNote(options) : null;
    const description = [keep.description, note].filter(Boolean).join("\n\n") || null;
    const { error } = await db.from("parts").update({ name: base, name_ar: null, description }).eq("id", keep.id);
    if (!error) renamed++;
  }
  return { groupsMerged, removed: losers.length, renamed };
}

async function placeholders(db: Db) {
  const { data } = await db.from("parts").select("id, sku").or("sku.eq.123,sku.like.GR-%");
  const ids = (data ?? []).map((p) => p.id as string);
  return { found: ids.length, ...(await removeParts(db, ids)) };
}

const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { i: { type: "INTEGER" }, ar: { type: "STRING" } }, required: ["i", "ar"] },
    },
  },
  required: ["items"],
};

async function translate(db: Db) {
  if (!geminiConfigured()) return { error: "gemini_not_configured" };
  const started = Date.now();
  let translated = 0;
  let batches = 0;
  while (Date.now() - started < 200_000) {
    const { data } = await db
      .from("parts")
      .select("id, name")
      .eq("is_published", true)
      .is("merged_into", null)
      .or("name_ar.is.null,name_ar.eq.")
      .order("sku")
      .limit(60);
    const rows = (data ?? []) as { id: string; name: string }[];
    if (!rows.length) break;
    batches++;
    let items: { i: number; ar: string }[] = [];
    try {
      const res = await callGemini({
        system:
          "You translate product names for an electronics and maker store in Qatar into Modern Standard Arabic. " +
          "Keep brand names, model and part numbers, units and values (e.g. ESP32, 10 kΩ, M3, 5V) in Latin script exactly as written. " +
          "Short, natural store names. Return every item with its index.",
        prompt: rows.map((r, i) => `${i}\t${r.name}`).join("\n"),
        schema: TRANSLATE_SCHEMA,
        temperature: 0.1,
        timeoutMs: 90_000,
      });
      items = ((res.raw as { items?: { i: number; ar: string }[] })?.items ?? []).filter((x) => rows[x.i] && x.ar?.trim());
    } catch (e) {
      return { translated, batches, error: e instanceof Error ? e.message : String(e) };
    }
    if (!items.length) break;
    for (const x of items) {
      const { error } = await db.from("parts").update({ name_ar: x.ar.trim().slice(0, 200) }).eq("id", rows[x.i].id);
      if (!error) translated++;
    }
  }
  const { count } = await db
    .from("parts")
    .select("id", { count: "exact", head: true })
    .eq("is_published", true)
    .is("merged_into", null)
    .or("name_ar.is.null,name_ar.eq.");
  return { translated, batches, remaining: count ?? null };
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const { step } = (await request.json().catch(() => ({}))) as { step?: string };
  const db = await createClient();
  if (step === "dedupe") return Response.json(await dedupe(db));
  if (step === "placeholders") return Response.json(await placeholders(db));
  if (step === "translate") return Response.json(await translate(db));
  return Response.json({ error: "unknown_step" }, { status: 400 });
}

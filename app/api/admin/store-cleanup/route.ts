import { getSessionContext } from "@/lib/auth/get-session";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { handleFromUrl } from "@/lib/sourcing/adapters/voltaat";
import { optionsNote } from "@/lib/sourcing/voltaat-catalogue";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { digikeySearch } from "@/lib/sourcing/adapters/digikey";
import { fetchImage, storeImage } from "@/lib/store/store-image";
import { ProviderError } from "@/lib/prototyping/providers/types";
import {
  DETAILS_SCHEMA,
  DETAILS_SYSTEM_PROMPT,
  detailsPrompt,
  detailsUpdate,
  hasWork,
  parseDetailsTranslation,
  takeBatch,
  translationSource,
  type DetailsPart,
  type DetailsResult,
  type DetailsSource,
} from "@/lib/store/translate-details";

// Store clean-up (owner, 2026-09-29). super_admin only. POST { step }:
//  - "dedupe": the Voltaat import made one product per option (CW / CCW
//    thruster…), which read as duplicates. Keep one product per Voltaat
//    product (the option in stock, else the first), name it by the product,
//    list the options in its description, delete the rest.
//  - "placeholders": delete the old sample products (SKU 123, GR-…).
//  - "photos": Mouser serves a bot page instead of product photos, so Mouser
//    products borrow the same part's photo from DigiKey (one lookup each, once).
//  - "translate": Arabic names for published products that have none, via
//    Gemini in batches. Call again until `remaining` is 0.
//  - "translate_details": Arabic description + spec table (0047); see below.
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

async function photos(db: Db) {
  const { data } = await db.from("parts").select("id, description").like("sku", "MS-%").is("image_url", null).limit(30);
  let added = 0;
  const missed: string[] = [];
  for (const p of data ?? []) {
    const mpn = /Manufacturer part: \S+(?: \S+)*? (\S+)$/m.exec((p.description as string) ?? "")?.[1];
    const hit = mpn ? (await digikeySearch(mpn, 1).catch(() => []))[0] : undefined;
    const buf = hit?.imageUrl ? await fetchImage(hit.imageUrl, /(^|\.)digikey\.com$/i).catch(() => null) : null;
    if (!buf) {
      missed.push(mpn ?? String(p.id));
      continue;
    }
    const img = await storeImage(db, buf, `supplier/digikey/${p.id}/${Date.now()}`);
    await db.from("parts").update({ images: [img], image_url: img.web }).eq("id", p.id);
    added++;
  }
  return { added, missed };
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

// ── "translate_details" (Phase E1, 2026-10-03) ───────────────────────────────
// Arabic description + spec table for every published product, into
// parts.description_ar / specs_ar, marked done with details_ar_at (0047).
// One sweep in sku order: each call handles the next products after `after`
// for up to ~110 s (a batch = ≤ 6 products / 9,000 characters per Gemini call,
// 55 s timeout; worst case with the client's retries stays under the 300 s
// limit) and returns {done, remaining, processed, cursor}; the admin page
// calls again with `after: cursor` until done. A product whose answer fails
// is skipped (not marked), so the next sweep retries it. Without `force`,
// already-translated products (details_ar_at set) and filled halves are never
// sent again. Admin-only, never automatic. Same free-tier model as "translate".

const DETAILS_COLS = "id, sku, name, name_ar, description, description_ar, specs, specs_ar, details_ar_at";
const DETAILS_BUDGET_MS = 110_000;
const DETAILS_FETCH = 30;

type DetailsRow = DetailsPart & { details_ar_at: string | null };

async function callDetails(sources: DetailsSource[]): Promise<DetailsResult[]> {
  const res = await callGemini({
    system: DETAILS_SYSTEM_PROMPT,
    prompt: detailsPrompt(sources),
    schema: DETAILS_SCHEMA,
    temperature: 0.1,
    timeoutMs: 55_000,
  });
  return parseDetailsTranslation(res.raw, sources);
}

async function translateDetails(db: Db, force: boolean, after: string | null) {
  if (!geminiConfigured()) return { error: "gemini_not_configured" };
  const started = Date.now();
  let cursor = after;
  let processed = 0;
  let translated = 0;
  let done = false;
  const failed: string[] = [];
  let stopError: string | null = null;

  const query = (cols: string, head = false) => {
    let q = db
      .from("parts")
      .select(cols, head ? { count: "exact", head: true } : undefined)
      .eq("is_published", true)
      .is("merged_into", null);
    if (!force) q = q.is("details_ar_at", null);
    if (cursor) q = q.gt("sku", cursor);
    return q;
  };

  while (Date.now() - started < DETAILS_BUDGET_MS) {
    const { data, error } = await query(DETAILS_COLS).order("sku").limit(DETAILS_FETCH);
    if (error) {
      // 42703 = column does not exist → 0047 not run yet.
      if (error.code === "42703" || /specs_ar|details_ar_at/.test(error.message)) return { error: "run_0047" };
      return { error: error.message };
    }
    const rows = (data ?? []) as unknown as DetailsRow[];
    if (!rows.length) {
      done = true;
      break;
    }
    const sources = rows.map((r) => translationSource(r, force));
    const n = takeBatch(sources);
    const batchRows = rows.slice(0, n);
    const batch = sources.slice(0, n);
    const work = batch.map((s, i) => ({ s, i })).filter((x) => hasWork(x.s));

    let results: DetailsResult[] = batch.map(() => ({ ok: true, description_ar: null, specs_ar: null }));
    if (work.length) {
      try {
        const got = await callDetails(work.map((x) => x.s));
        work.forEach((x, k) => (results[x.i] = got[k]));
      } catch (e) {
        if (e instanceof ProviderError && e.reason === "rate_limited") {
          stopError = "rate_limited";
          break;
        }
        // The whole call failed: try each product alone so one bad product
        // cannot sink its batch (as long as time allows).
        results = batch.map(() => ({ ok: false, reason: "call_failed" }) as DetailsResult);
        if (work.length > 1) {
          for (const x of work) {
            if (Date.now() - started > DETAILS_BUDGET_MS) break;
            try {
              results[x.i] = (await callDetails([x.s]))[0];
            } catch (one) {
              if (one instanceof ProviderError && one.reason === "rate_limited") {
                stopError = "rate_limited";
                break;
              }
            }
          }
        }
        for (const [i, s] of batch.entries()) if (!hasWork(s)) results[i] = { ok: true, description_ar: null, specs_ar: null };
      }
    }

    const now = new Date().toISOString();
    for (const [i, row] of batchRows.entries()) {
      const update = detailsUpdate(batch[i], results[i], now);
      if (!update) {
        failed.push(row.sku);
        continue;
      }
      const { error: upErr } = await db.from("parts").update(update).eq("id", row.id);
      if (upErr) failed.push(row.sku);
      else if (hasWork(batch[i])) translated++;
    }
    processed += batchRows.length;
    cursor = batchRows[batchRows.length - 1].sku;
    if (stopError) break;
  }

  const { count: remaining } = await query("id", true);
  // Everything still without Arabic details (also before the cursor: the
  // products that failed in this sweep).
  const { count: untranslated } = await db
    .from("parts")
    .select("id", { count: "exact", head: true })
    .eq("is_published", true)
    .is("merged_into", null)
    .is("details_ar_at", null);
  return {
    done: done || (!stopError && remaining === 0),
    processed,
    translated,
    failed: failed.length,
    failedSkus: failed.slice(0, 20),
    remaining: remaining ?? null,
    untranslated: untranslated ?? null,
    cursor,
    ...(stopError ? { error: stopError } : {}),
  };
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { step?: string; force?: unknown; after?: unknown };
  const { step } = body;
  const db = await createClient();
  let result: unknown;
  if (step === "dedupe") result = await dedupe(db);
  else if (step === "placeholders") result = await placeholders(db);
  else if (step === "photos") result = await photos(db);
  else if (step === "translate") result = await translate(db);
  else if (step === "translate_details") {
    const after = typeof body.after === "string" && body.after.length <= 200 ? body.after : null;
    result = await translateDetails(db, body.force === true, after);
  } else return Response.json({ error: "unknown_step" }, { status: 400 });
  // Every step edits published products: refresh the cached storefront.
  revalidateStorefront();
  return Response.json(result);
}

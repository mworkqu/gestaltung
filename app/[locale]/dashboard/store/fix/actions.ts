"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { loadFixParts } from "@/lib/admin/fix-data";
import type { BulkItemResult } from "@/lib/admin/fix-groups";
import type { FixIssue } from "@/lib/admin/home-tiles";
import {
  ensureOwnStockSupplier,
  mapLimit,
  setPartDelivery,
  supplierRef,
  updateOnRequest,
  type SupplierRef,
} from "@/lib/admin/fix-delivery";

// Fix list actions (D1). super_admin only — checked here and again by RLS.
// The client sends at most MAX_IDS products per call (it batches) and shows
// "N fixed, M failed — see why" from the per-product results.

const MAX_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BulkResponse = { results: BulkItemResult[] } | { error: "forbidden" | "input" | "load" | "supplier" };

async function isAdmin() {
  const s = await getSessionContext();
  return s?.profile.role === "super_admin";
}

function cleanIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null;
  const out = Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x))));
  return out.length > 0 && out.length <= MAX_IDS ? out : null;
}

function cleanLead(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.trunc(n) : null;
}

function refresh(locale: string) {
  const l = locale === "ar" ? "ar" : "en";
  revalidateStorefront();
  revalidatePath(`/${l}/dashboard/store/fix`);
  revalidatePath(`/${l}/dashboard/store`);
  revalidatePath(`/${l}/dashboard`);
}

async function names(db: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const { data, error } = await db.from("parts").select("id, name").in("id", ids);
  if (error) return null;
  return new Map((data ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));
}

async function resolveSupplier(db: Awaited<ReturnType<typeof createClient>>, supplier: string): Promise<SupplierRef | null> {
  if (supplier === "own") return ensureOwnStockSupplier(db);
  if (!UUID.test(supplier)) return null;
  return supplierRef(db, supplier);
}

/** "Set delivery time": one offer per product (supplier or own stock) + recompute. */
export async function bulkSetDelivery(
  locale: string,
  ids: string[],
  input: { supplier: string; leadDays: number | string }
): Promise<BulkResponse> {
  if (!(await isAdmin())) return { error: "forbidden" };
  const clean = cleanIds(ids);
  const lead = cleanLead(input?.leadDays);
  if (!clean || lead === null || typeof input?.supplier !== "string") return { error: "input" };
  const db = await createClient();
  const nameById = await names(db, clean);
  if (!nameById) return { error: "load" };
  const supplier = await resolveSupplier(db, input.supplier);
  if (!supplier) return { error: "supplier" };

  const results = await mapLimit(clean, 5, async (id): Promise<BulkItemResult> => {
    const name = nameById.get(id) ?? id;
    if (!nameById.has(id)) return { id, name, ok: false, reason: "notFound" };
    const r = await setPartDelivery(db, id, supplier, lead);
    return r.ok ? { id, name, ok: true } : { id, name, ok: false, reason: r.reason };
  });
  // A product with a real date is no longer "on request".
  await updateOnRequest(db, { remove: results.filter((r) => r.ok).map((r) => r.id) });
  refresh(locale);
  return { results };
}

/** "Mark on request": the product stops asking for a supplier / delivery date. */
export async function bulkMarkOnRequest(locale: string, ids: string[]): Promise<BulkResponse> {
  if (!(await isAdmin())) return { error: "forbidden" };
  const clean = cleanIds(ids);
  if (!clean) return { error: "input" };
  const db = await createClient();
  const nameById = await names(db, clean);
  if (!nameById) return { error: "load" };
  const found = clean.filter((id) => nameById.has(id));
  const saved = found.length === 0 ? true : await updateOnRequest(db, { add: found });
  const results: BulkItemResult[] = clean.map((id) => {
    const name = nameById.get(id) ?? id;
    if (!nameById.has(id)) return { id, name, ok: false, reason: "notFound" };
    return saved ? { id, name, ok: true } : { id, name, ok: false, reason: "settings" };
  });
  refresh(locale);
  return { results };
}

/** "Unpublish": hides the products from the store (and from the Fix list). */
export async function bulkUnpublish(locale: string, ids: string[]): Promise<BulkResponse> {
  if (!(await isAdmin())) return { error: "forbidden" };
  const clean = cleanIds(ids);
  if (!clean) return { error: "input" };
  const db = await createClient();
  const nameById = await names(db, clean);
  if (!nameById) return { error: "load" };
  const { data, error } = await db.from("parts").update({ is_published: false }).in("id", clean).select("id");
  const done = new Set((data ?? []).map((r: { id: string }) => r.id));
  const results: BulkItemResult[] = clean.map((id) => {
    const name = nameById.get(id) ?? id;
    if (error) return { id, name, ok: false, reason: "unpublish" };
    return done.has(id) ? { id, name, ok: true } : { id, name, ok: false, reason: "notFound" };
  });
  refresh(locale);
  return { results };
}

export type FixOneInput = {
  imageUrl?: string | null;
  price?: number | string | null;
  offer?: { supplier: string; leadDays: number | string; cost?: number | string | null } | null;
};

export type FixOneResponse =
  | { ok: true; remaining: FixIssue[] }
  | { error: "forbidden" | "input" | "image" | "price" | "save" | "supplier" | "lead"; reason?: string };

/** The drawer's Save: only the fields that were missing. Returns what is still missing. */
export async function fixOne(locale: string, partId: string, input: FixOneInput): Promise<FixOneResponse> {
  if (!(await isAdmin())) return { error: "forbidden" };
  if (typeof partId !== "string" || !UUID.test(partId)) return { error: "input" };
  const db = await createClient();

  const patch: Record<string, unknown> = {};
  if (input.imageUrl !== undefined && input.imageUrl !== null && String(input.imageUrl).trim() !== "") {
    const url = String(input.imageUrl).trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) return { error: "image" };
    patch.image_url = url;
  }
  if (input.price !== undefined && input.price !== null && String(input.price).trim() !== "") {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return { error: "price" };
    patch.unit_price = Math.round(price * 100) / 100;
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("parts").update(patch).eq("id", partId);
    if (error) return { error: "save" };
  }

  if (input.offer) {
    const lead = cleanLead(input.offer.leadDays);
    if (lead === null) return { error: "lead" };
    const supplier = await resolveSupplier(db, String(input.offer.supplier ?? ""));
    if (!supplier) return { error: "supplier" };
    const costRaw = input.offer.cost;
    const cost = costRaw === undefined || costRaw === null || String(costRaw).trim() === "" ? null : Number(costRaw);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { error: "input" };
    const r = await setPartDelivery(db, partId, supplier, lead, { cost });
    if (!r.ok) return { error: "save", reason: r.reason };
    await updateOnRequest(db, { remove: [partId] });
  }

  refresh(locale);
  const left = await loadFixParts(db, { ids: [partId] });
  if (left === null) return { error: "save" };
  return { ok: true, remaining: left[0]?.issues ?? [] };
}

/**
 * Production wiring of the MCP server's dependencies. Server-only: public reads go
 * through the cookie-free anon client (published parts only, never a cost or margin
 * field); writes (hand-offs, leads, the rate counter) go through the service client.
 * No cookies are read or set anywhere here.
 */
import "server-only";

import { getCadEngineSetting } from "@/lib/cad/engine-server";
import { ipHash as hashIp } from "@/lib/credits/server";
import { defaultSiteUrl } from "@/lib/email/brand-layout";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { parseStoreParams } from "@/lib/store/catalog";
import { arrivesByDate } from "@/lib/store/delivery";
import { getStoreListing } from "@/lib/store/public-catalog";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import { studioLibrary } from "@/lib/studio/library/remote";
import type { Json } from "@/lib/supabase/database.types";
import { isMissingFunction, isMissingRelation } from "@/lib/supabase/errors";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";
import type { PluginProduct } from "../check-project";
import { pluginLibraryFrom } from "../to-studio";
import { PluginNotSetUpError, type PluginServerDeps, type SearchPartRow } from "./register";

const MAX_SKUS = 100;
const DEFAULT_MIN_WALL_MM = 1.2;
const PRODUCT_COLUMNS = "sku, name, name_ar, unit_price, pack_size, min_order_qty, lead_time_class";

type ProductRow = {
  sku: string;
  name: string;
  name_ar: string | null;
  unit_price: number | null;
  pack_size: number | null;
  min_order_qty: number | null;
  lead_time_class: string | null;
};

async function loadProducts(skus: string[]): Promise<ReadonlyMap<string, PluginProduct>> {
  const out = new Map<string, PluginProduct>();
  const list = [...new Set(skus)].slice(0, MAX_SKUS);
  const supabase = createPublicClient();
  if (!supabase || !list.length) return out;
  const { data, error } = await supabase
    .from("parts")
    .select<string, ProductRow>(PRODUCT_COLUMNS)
    .in("sku", list)
    .eq("is_published", true)
    .is("merged_into", null);
  if (error) throw new Error(`parts read failed: ${error.message}`);
  for (const p of data ?? []) out.set(p.sku, p);
  return out;
}

function makeSearchParts(siteUrl: string): PluginServerDeps["searchParts"] {
  return async (query, category, limit, locale) => {
    const { parts } = await getStoreListing(parseStoreParams({ q: query, category }), locale);
    const rows = parts.filter((p) => p.lead_time_class).slice(0, limit);
    if (!rows.length) return [];

    const packs = new Map<string, number | null>();
    const supabase = createPublicClient();
    if (supabase) {
      const { data } = await supabase
        .from("parts")
        .select<string, { sku: string; pack_size: number | null }>("sku, pack_size")
        .in("sku", rows.map((p) => p.sku));
      for (const r of data ?? []) packs.set(r.sku, r.pack_size);
    }
    const shipping = await loadShippingSettings();

    return rows.map(
      (p): SearchPartRow => ({
        sku: p.sku,
        name: p.name,
        name_ar: p.name_ar,
        price_qar: Number(p.unit_price),
        pack_size: packs.get(p.sku) ?? null,
        lead_time_class: p.lead_time_class as string,
        arrives_by: arrivesByDate(p.lead_time_class, shipping),
        url: `${siteUrl}/${locale}/store/${encodeURIComponent(p.sku)}`,
      }),
    );
  };
}

// ── rate limit ───────────────────────────────────────────────────────────────

/** Before 0112 runs (or without a service key): per-instance limiter, one per limit value. */
const memoryLimiters = new Map<number, RateLimiter>();
let warnedRate = false;

function memoryHit(key: string, limit: number): boolean {
  let l = memoryLimiters.get(limit);
  if (!l) {
    // The window is encoded in the key; the timer only has to outlive the longest one (a day).
    l = createRateLimiter({ limit, windowMs: 25 * 3_600_000 });
    memoryLimiters.set(limit, l);
  }
  return l.hit(key).allowed;
}

async function rateHit(key: string, limit: number): Promise<boolean> {
  const svc = createServiceClient();
  if (!svc) return memoryHit(key, limit);
  try {
    const { data, error } = await svc.rpc("plugin_rate_hit", { p_key: key, p_limit: limit });
    if (error) {
      if (isMissingFunction(error)) return memoryHit(key, limit);
      throw error;
    }
    const allowed = (data as { allowed?: unknown } | null)?.allowed;
    return allowed !== false;
  } catch (err) {
    // Fail open: a counter outage must not take the plugin down.
    if (!warnedRate) {
      warnedRate = true;
      console.warn("[mcp] plugin_rate_hit failed, allowing:", err);
    }
    return true;
  }
}

// ── writes ───────────────────────────────────────────────────────────────────

function serviceOrNotSetUp() {
  const svc = createServiceClient();
  if (!svc) throw new PluginNotSetUpError("no service key");
  return svc;
}

const notSetUp = (e: unknown) => isMissingRelation(e) || isMissingFunction(e);

export function realDeps(): PluginServerDeps {
  const siteUrl = defaultSiteUrl();
  return {
    loadLibrary: async () => pluginLibraryFrom(await studioLibrary()),
    loadProducts,
    searchParts: makeSearchParts(siteUrl),
    minWallMm: async () => {
      try {
        return (await getCadEngineSetting()).minWallMm || DEFAULT_MIN_WALL_MM;
      } catch {
        return DEFAULT_MIN_WALL_MM;
      }
    },
    ipHash: (req) => (req ? hashIp(req) : null),
    rateHit,
    storeHandoff: async (row) => {
      const svc = serviceOrNotSetUp();
      const { data, error } = await svc
        .from("plugin_handoffs")
        .insert({ ...row, build: row.build as unknown as Json, studio_doc: row.studio_doc as unknown as Json })
        .select("id")
        .single();
      if (error) {
        if (notSetUp(error)) throw new PluginNotSetUpError(error.message);
        throw new Error(`plugin_handoffs insert failed: ${error.message}`);
      }
      return { id: data.id };
    },
    createLead: async (row) => {
      const svc = serviceOrNotSetUp();
      const { data, error } = await svc
        .from("inquiries")
        .insert({ ...row, status: "new" })
        .select("id")
        .single();
      if (error) throw new Error(`inquiries insert failed: ${error.message}`);
      return { id: data.id };
    },
    linkLead: async (handoffId, inquiryId) => {
      const svc = serviceOrNotSetUp();
      const { error } = await svc.from("plugin_handoffs").update({ inquiry_id: inquiryId }).eq("id", handoffId);
      if (error) throw new Error(`plugin_handoffs link failed: ${error.message}`);
    },
    sendOwnerEmail: (mail) => sendEmail({ to: [OWNER_EMAIL], subject: mail.subject, html: mail.html, text: mail.text }),
    siteUrl,
    now: () => new Date(),
  };
}

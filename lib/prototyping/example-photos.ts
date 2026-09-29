// Example photos for the picture wiring diagram (owner, 2026-09-29). When a
// circuit part has no store product yet ("Servo motor" not chosen), the
// diagram can still show what that kind of part looks like, using a photo we
// already have in the store, labelled "Example photo". Never generated.

import type { SupabaseClient } from "@supabase/supabase-js";

import { partImageUrl } from "@/lib/parts/format";
import type { WiringProduct } from "./wiring-svg";

const STOP = new Set([
  "the", "and", "for", "with", "module", "board", "sensor", "unit", "small", "main", "control", "controller",
  "status", "indicator", "optional", "external", "power", "signal", "input", "output", "driver", "circuit",
]);

/**
 * What to search the store for, most specific first: the whole function, then
 * its distinctive words (longest first). "Servo motor" → ["servo motor",
 * "servo", "motor"]; generic words like "module" or "sensor" alone are skipped
 * because they'd match anything.
 */
export function exampleQueries(fn: string): string[] {
  const clean = fn.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = [...new Set(clean.split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
  const out = [clean, ...words.sort((a, b) => b.length - a.length)];
  return [...new Set(out)].slice(0, 4);
}

type Row = { sku: string; name: string; image_url: string | null };

/**
 * One example per function, for components the diagram has no product for.
 * Only published products with a photo, in stock first. Keyed by BOM line id.
 */
export async function loadExamplePhotos(
  db: SupabaseClient,
  wanted: { bomId: string; fn: string }[],
  locale: string
): Promise<Map<string, WiringProduct>> {
  const out = new Map<string, WiringProduct>();
  const byFn = new Map<string, WiringProduct | null>();
  for (const w of wanted) {
    const key = w.fn.toLowerCase();
    if (!byFn.has(key)) {
      let found: WiringProduct | null = null;
      for (const q of exampleQueries(w.fn)) {
        const { data } = await db
          .from("parts")
          .select("sku, name, image_url")
          .eq("is_published", true)
          .is("merged_into", null)
          .not("image_url", "is", null)
          .ilike("name", `%${q.replace(/[%_,()]/g, " ")}%`)
          // "in_stock" sorts last alphabetically, so descending puts it first.
          .order("lead_time_class", { ascending: false, nullsFirst: false })
          .limit(1);
        const row = (data ?? [])[0] as Row | undefined;
        const image = row ? partImageUrl(row) : null;
        if (row && image) {
          found = { name: row.name, sku: row.sku, href: `/${locale}/store/${encodeURIComponent(row.sku)}`, image, example: true };
          break;
        }
      }
      byFn.set(key, found);
    }
    const hit = byFn.get(key);
    if (hit) out.set(w.bomId, hit);
  }
  return out;
}

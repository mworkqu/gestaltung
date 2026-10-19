// Loads published products plus their supplier offers for the Fix tile and
// the Fix page (server only, super admin through the cookie client). The Home
// tile counts loadFixParts(...).length, so the tile and the page always agree.

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/server";
import { fixIssues, isLiveProduct, type FixIssue, type FixPart } from "@/lib/admin/home-tiles";
import {
  deliveryWhy,
  isAutoOnRequest,
  ON_REQUEST_KEY,
  parseOnRequest,
  supplierBucket,
  type FixOffer,
  type SupplierBucket,
  type Why,
} from "@/lib/admin/fix-groups";

type Db = Awaited<ReturnType<typeof createClient>>;

type Row = Omit<FixPart, "hasSupplier" | "onRequest"> & {
  id: string;
  name: string;
  pricing_mode?: string | null;
  in_own_stock?: boolean | null;
};

export type FixItem = {
  part: Row;
  issues: FixIssue[];
  bucket: SupplierBucket;
  /** Set when "delivery" is one of the issues. */
  why: Why | null;
  offers: FixOffer[];
};

type OfferRow = {
  part_id: string;
  active: boolean | null;
  availability: string | null;
  lead_time_days: number | null;
  retail_price: number | string | null;
  supplier: { code: string | null; name: string | null; active: boolean | null; commission_percent: number | string | null } | null;
};

const PART_COLS =
  "id, sku, name, unit_price, image_url, images, lead_time_class, is_test, is_published, merged_into, pricing_mode, in_own_stock";
const OFFER_COLS =
  "part_id, active, availability, lead_time_days, retail_price, supplier:suppliers(code, name, active, commission_percent)";

const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function toOffer(o: OfferRow): FixOffer {
  return {
    supplierCode: o.supplier?.code ?? null,
    supplierName: o.supplier?.name ?? null,
    supplierActive: o.supplier?.active !== false,
    commission: numOrNull(o.supplier?.commission_percent),
    active: o.active !== false,
    availability: o.availability,
    leadDays: o.lead_time_days,
    retailPrice: numOrNull(o.retail_price),
  };
}

/** Part ids the owner marked "on request" (store_settings). Null when unreadable. */
export async function loadOnRequest(db: Db): Promise<Set<string> | null> {
  const { data, error } = await db.from("store_settings").select("value").eq("key", ON_REQUEST_KEY).maybeSingle();
  if (error) return null;
  return parseOnRequest(data?.value);
}

/**
 * Live products that miss something, name order. Null when the data could not
 * be read. `ids` limits it to those products (after a fix in the drawer).
 */
export async function loadFixParts(db: Db, opts: { ids?: string[] } = {}): Promise<FixItem[] | null> {
  const ids = opts.ids;
  if (ids && ids.length === 0) return [];
  const parts = await fetchAllRows<Row>((from, to) => {
    let q = db.from("parts").select(PART_COLS).eq("is_published", true).is("merged_into", null);
    if (ids) q = q.in("id", ids);
    return q.order("id").range(from, to);
  });
  if (parts.error) return null;
  const offers = await fetchAllRows<OfferRow>((from, to) => {
    let q = db.from("supplier_offers").select(OFFER_COLS);
    if (ids) q = q.in("part_id", ids);
    return q.order("id").range(from, to);
  });
  if (offers.error) return null;
  const onRequest = await loadOnRequest(db);
  if (onRequest === null) return null;

  const byPart = new Map<string, FixOffer[]>();
  for (const o of offers.rows) {
    const list = byPart.get(o.part_id) ?? [];
    list.push(toOffer(o));
    byPart.set(o.part_id, list);
  }

  return parts.rows
    .map((p) => {
      const partOffers = byPart.get(p.id) ?? [];
      const full: FixPart = { ...p, hasSupplier: partOffers.length > 0, onRequest: onRequest.has(p.id) };
      return { part: p, full, partOffers };
    })
    .filter(({ full }) => isLiveProduct(full))
    .map(({ part, full, partOffers }) => {
      // Why there is no date, worked out before the issue list, because an
      // out-of-stock supplier counts as "on request" rather than as a gap.
      const why = part.lead_time_class ? null : deliveryWhy({ pricingMode: part.pricing_mode, offers: partOffers });
      const treatAsOnRequest = full.onRequest || isAutoOnRequest(why);
      const issues = fixIssues({ ...full, onRequest: treatAsOnRequest });
      return {
        part,
        issues,
        offers: partOffers,
        bucket: supplierBucket({ sku: part.sku, inOwnStock: part.in_own_stock, offers: partOffers }),
        why: issues.includes("delivery") ? why : null,
      };
    })
    .filter((x) => x.issues.length > 0)
    .sort((a, b) => a.part.name.localeCompare(b.part.name));
}

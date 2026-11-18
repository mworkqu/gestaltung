/**
 * check_project for the chat plugin: build file → our Studio doc → the parts priced the way
 * the Studio's "Add all to cart" prices them (studioKitPlan + pack maths). Pure: the server
 * loads the products by SKU (storeSkusFor) and passes them in. Only unit_price ever leaves
 * here, never a cost or a margin.
 */
import { round2 } from "@/lib/format/money";
import type { StoreCardPart } from "@/lib/store/catalog";
import { buildConnections } from "@/lib/studio/connections";
import { studioKitPlan } from "@/lib/studio/kit-plan";
import type { StudioDoc } from "@/lib/studio/schema";
import { skusFor } from "@/lib/studio/variants";
import { parseBuildFile, type BuildFile } from "./build-file";
import { buildToStudio, type PluginLibrary } from "./to-studio";

export type PluginProduct = {
  sku: string;
  name: string;
  name_ar: string | null;
  unit_price: number | null;
  pack_size?: number | null;
  min_order_qty?: number | null;
  lead_time_class?: string | null;
};

export type CheckPart = {
  id: string;
  name: string;
  qty: number;
  sku?: string;
  price_qar?: number;
  status: "in_store" | "we_source";
};

export type CheckResult = {
  ok: boolean;
  problems: string[];
  warnings: string[];
  parts: CheckPart[];
  parts_total_qar: number;
  wiring_summary: string;
  /** Kept by the server; the MCP tools strip it from the AI's reply. */
  doc: StudioDoc | null;
};

export type CheckDeps = { lib: PluginLibrary; products: ReadonlyMap<string, PluginProduct> };

const uniq = (xs: string[]) => [...new Set(xs)];

/** Every SKU behind the doc's parts, helpers our wiring added included. */
export function skusForDoc(doc: StudioDoc, lib: PluginLibrary): string[] {
  return uniq(doc.components.flatMap((c) => skusFor(lib.getPart(c.partId), c.variant)));
}

/**
 * Every SKU the server must load prices for. The mapping is run first so parts our rules add
 * (a MOSFET switch, a resistor, a boost converter) are priced too; when it cannot map, the
 * requested parts' own SKUs are enough to answer.
 */
export function storeSkusFor(build: BuildFile, lib: PluginLibrary): string[] {
  const r = buildToStudio(build, lib);
  if (r.doc) return skusForDoc(r.doc, lib);
  return uniq(build.parts.flatMap((p) => lib.getPart(p.library_id)?.storeSkus ?? []));
}

/** The StoreCardPart shape studioKitPlan reads. id = SKU: a plan row is keyed by product id. */
function cardOf(p: PluginProduct): StoreCardPart {
  const card = {
    id: p.sku,
    sku: p.sku,
    name: p.name,
    name_ar: p.name_ar,
    unit_price: p.unit_price,
    image_url: null,
    category: "",
    min_order_qty: p.min_order_qty ?? 1,
    pack_size: p.pack_size ?? null,
  };
  return card as unknown as StoreCardPart;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function checkProject(raw: unknown, deps: CheckDeps, opts: { locale?: "en" | "ar" } = {}): CheckResult {
  const empty = (problems: string[], warnings: string[] = []): CheckResult => ({
    ok: false,
    problems,
    warnings,
    parts: [],
    parts_total_qar: 0,
    wiring_summary: "",
    doc: null,
  });
  const parsed = parseBuildFile(raw);
  if (!parsed.ok) return empty(parsed.errors);

  const { lib } = deps;
  const r = buildToStudio(parsed.value, lib, { locale: opts.locale });
  if (!r.doc) return empty(r.problems, r.warnings);
  const doc = r.doc;

  // Only a product with a price can be sold; the rest is "we'll source this".
  const products = new Map<string, StoreCardPart>();
  for (const [sku, p] of deps.products) if (p.unit_price !== null && Number.isFinite(p.unit_price)) products.set(sku, cardOf(p));
  const plan = studioKitPlan(doc.components, products, lib.getPart);

  const qty = new Map<string, number>();
  for (const c of doc.components) qty.set(c.partId, (qty.get(c.partId) ?? 0) + 1);
  // A listing row can cover two different parts; its total is split by pieces.
  const priced = new Map<string, { sku: string; price: number }>();
  for (const row of plan.rows) {
    const ids = uniq(row.partIds);
    for (const id of ids) {
      const share = ids.length === 1 ? row.lineTotal : (row.lineTotal * (qty.get(id) ?? 0)) / Math.max(1, row.need);
      const cur = priced.get(id);
      priced.set(id, { sku: cur?.sku ?? row.product.sku, price: (cur?.price ?? 0) + share });
    }
  }

  const parts: CheckPart[] = [...qty].map(([id, n]) => {
    const name = lib.getPart(id)?.name.en ?? id;
    const p = priced.get(id);
    return p
      ? { id, name, qty: n, sku: p.sku, price_qar: round2(p.price), status: "in_store" as const }
      : { id, name, qty: n, status: "we_source" as const };
  });

  const connections = buildConnections(doc.components, doc.netlist.nets, lib.getPart, doc.spec).length;
  const changed = r.added.length;
  const tail = r.problems.length ? plural(r.problems.length, "problem", "problems") : "all checks passed";
  const wiring_summary =
    `${plural(connections, "connection", "connections")} on ${plural(doc.netlist.nets.length, "net", "nets")}; ` +
    `${plural(changed, "part", "parts")} added by our rules; ${tail}`;

  return {
    ok: r.problems.length === 0,
    problems: r.problems,
    warnings: r.warnings,
    parts,
    parts_total_qar: round2(plan.goods),
    wiring_summary,
    doc,
  };
}

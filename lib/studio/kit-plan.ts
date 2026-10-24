// What the Studio's "Add all to cart" writes, worked out ONCE (F-006).
//
// The Parts step used to hand a list of lines to a client-side loop that added
// them one at a time — the same shape as the kit bug fixed in P5-02: the loop
// could stop part way and leave a half-filled cart with no rollback, and the
// words on screen came from the list it MEANT to add rather than the rows that
// were written. So the plan is computed here, once, and the cart writes it in
// one statement (components/parts/cart-provider addKit / addAll).
//
//   rows      one per store product, quantity = packsFor(pieces) — a line
//             needing 1 LED from a pack of 5 is 1 pack — raised to the
//             product's minimum order. EVERY part with a listing is here:
//             helper parts the wiring added for the visitor ("Added for you")
//             and pack listings included; identical parts share one row.
//   sourced   the lines with no listing: "We'll source this". Never silently
//             dropped — the step lists them and the toast counts them.
//   added / toSource / goods   the numbers the toast and the total show, read
//             from `rows` and `sourced`, so they are what the cart receives.
//
// Pure and client-safe: no React, no next-intl, no library import (the caller
// passes getPart, so this file never drags the part library into a bundle).

import type { StoreCardPart } from "@/lib/store/catalog";
import { packSizeOf, packsFor } from "@/lib/store/pack";
import { groupComponents } from "./parts-group";
import type { LibraryPart, StudioComponent } from "./schema";
import { skusFor } from "./variants";

export type GetLibraryPart = (id: string) => LibraryPart | undefined;

/** The store product sold for a library part (its colour's listing first, else the first published SKU). */
export function productForPart(
  partId: string,
  products: Map<string, StoreCardPart>,
  getPart: GetLibraryPart,
  variant?: string | null,
): StoreCardPart | null {
  for (const sku of skusFor(getPart(partId), variant)) {
    const p = products.get(sku);
    if (p) return p;
  }
  return null;
}

/** One cart row: a listing, the listings to buy, and the parts it covers. */
export type StudioKitRow = {
  product: StoreCardPart;
  /** Pieces the parts need. */
  need: number;
  /** Pieces in one listing. */
  packSize: number;
  /** Listings to add: ceil(need ÷ packSize), at least the minimum order. */
  quantity: number;
  /** unit_price × quantity, QAR. */
  lineTotal: number;
  /** The part ids this row buys (an auto helper and a chosen part can share one listing). */
  partIds: string[];
};

/** A part we cannot sell yet: listed as "We'll source this" and counted in the toast. */
export type StudioSourcedLine = { partId: string; variant?: string; quantity: number; auto: boolean };

export type StudioKitPlan = {
  rows: StudioKitRow[];
  sourced: StudioSourcedLine[];
  /** rows.length: lines the cart will hold. */
  added: number;
  /** sourced.length: lines we will source. */
  toSource: number;
  /** Σ unit_price × quantity over `rows`, QAR. */
  goods: number;
};

export function studioKitPlan(
  components: readonly StudioComponent[],
  products: Map<string, StoreCardPart>,
  getPart: GetLibraryPart,
): StudioKitPlan {
  const byProduct = new Map<string, StudioKitRow>();
  const sourced: StudioSourcedLine[] = [];
  // Grouped exactly as the step lists them, so "N parts · M we'll source"
  // counts the same lines the visitor is looking at.
  for (const g of groupComponents(components)) {
    const product = productForPart(g.partId, products, getPart, g.variant);
    if (!product) {
      sourced.push({ partId: g.partId, ...(g.variant ? { variant: g.variant } : {}), quantity: g.quantity, auto: g.auto });
      continue;
    }
    const row = byProduct.get(product.id);
    if (row) {
      row.need += g.quantity;
      row.partIds.push(g.partId);
    } else
      byProduct.set(product.id, {
        product,
        need: g.quantity,
        packSize: packSizeOf(product),
        quantity: 0,
        lineTotal: 0,
        partIds: [g.partId],
      });
  }

  const rows = [...byProduct.values()].map((r) => {
    const quantity = packsFor(r.need, r.product);
    return { ...r, quantity, lineTotal: Number(r.product.unit_price ?? 0) * quantity };
  });
  return {
    rows,
    sourced,
    added: rows.length,
    toSource: sourced.length,
    goods: rows.reduce((s, r) => s + r.lineTotal, 0),
  };
}

/** One cart row of a project kit, as the cart writes it (components/parts/cart-provider KitRowInput). */
export type StudioCartRow = { part: StoreCardPart; quantity: number; bomLines: string[] };

/**
 * The rows the cart inserts, one per listing. `bomLines` is empty on purpose:
 * the Studio has no BOM line ids, and the cart uses them to say which BOM line
 * a row fulfils.
 */
export const kitRowsFor = (plan: StudioKitPlan): StudioCartRow[] =>
  plan.rows.map((r) => ({ part: r.product, quantity: r.quantity, bomLines: [] }));

/** The toast's numbers, counted from the rows that were WRITTEN plus what is left to source. */
export const addedCounts = (rows: readonly StudioCartRow[], plan: StudioKitPlan) => ({
  added: rows.length,
  sourced: plan.sourced.length,
});

// ── What the visitor is told ─────────────────────────────────────────────────
//
// EN + AR live here, next to the numbers, because messages/** is owned
// centrally and this wording has to ship with the counts (same arrangement as
// lib/studio/plain-checks.ts). The keys to move it to are in the report:
// Studio.addedToCart / Studio.addedToCartPlusSourced.

type Locale = "en" | "ar";

const arForm = (n: number) => {
  const v = Math.abs(Math.trunc(n));
  if (v === 1) return "one";
  if (v === 2) return "two";
  return v <= 10 ? "few" : "many";
};

const enParts = (n: number) => `${n} ${n === 1 ? "part" : "parts"}`;

const arParts = (n: number) => {
  const f = arForm(n);
  if (f === "one") return "قطعة واحدة";
  if (f === "two") return "قطعتين";
  return f === "few" ? `${n} قطع` : `${n} قطعة`;
};

/**
 * "Added 5 parts · 2 we'll source" — from the plan that was WRITTEN, never
 * from the list that was intended.
 */
export function addedToCartLine(added: number, toSource: number, locale: Locale): string {
  if (locale === "ar") {
    const head = `أضفنا ${arParts(added)}`;
    return toSource > 0 ? `${head} · ${toSource} سنوفّرها لك` : head;
  }
  const head = `Added ${enParts(added)}`;
  return toSource > 0 ? `${head} · ${toSource} we'll source` : head;
}

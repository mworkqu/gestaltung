"use client";

// Store products for the Studio's parts, and "Add all to cart". Part D: each
// product goes in once with the packs its parts need (6 servos = 6 pieces →
// packsFor(6), raised to the minimum order). Parts without a store product are
// "We'll source this".

import { useCallback, useState } from "react";

import { useCart } from "@/components/parts/cart-provider";
import { getPart as codeGetPart } from "@/lib/studio/library";
import type { LibraryPart } from "@/lib/studio/schema";

type GetPart = (id: string) => LibraryPart | undefined;
import type { StudioComponent } from "@/lib/studio/schema";
import type { StoreCardPart } from "@/lib/store/catalog";
import { packsFor } from "@/lib/store/pack";

/** The store product sold for a library part (first published SKU), if any. */
export function productFor(
  partId: string,
  products: Map<string, StoreCardPart>,
  getPart: GetPart = codeGetPart,
): StoreCardPart | null {
  for (const sku of getPart(partId)?.storeSkus ?? []) {
    const p = products.get(sku);
    if (p) return p;
  }
  return null;
}

/** Store listings to buy for `need` pieces of a part (packs, at least the minimum order). */
export const orderQty = (p: StoreCardPart, need = 1) => packsFor(need, p);

/** Price of `need` pieces of a part: unit price × the listings it takes. */
export const linePrice = (p: StoreCardPart, need = 1) => Number(p.unit_price ?? 0) * orderQty(p, need);

export type StoreLine = { product: StoreCardPart; /** pieces the parts need */ need: number; /** listings to add */ qty: number };

/** One line per store product (identical parts summed), and the total of those. */
export function storeLines(
  components: StudioComponent[],
  products: Map<string, StoreCardPart>,
  getPart: GetPart = codeGetPart,
) {
  const byId = new Map<string, StoreLine>();
  for (const c of components) {
    const p = productFor(c.partId, products, getPart);
    if (!p) continue;
    const line = byId.get(p.id);
    if (line) line.need++;
    else byId.set(p.id, { product: p, need: 1, qty: 1 });
  }
  const lines = [...byId.values()].map((l) => ({ ...l, qty: orderQty(l.product, l.need) }));
  const total = lines.reduce((s, l) => s + Number(l.product.unit_price ?? 0) * l.qty, 0);
  return { lines, total };
}

export function useAddAllToCart(projectId: string | null) {
  const { addItem } = useCart();
  const [state, setState] = useState<"idle" | "adding" | "added" | "failed">("idle");
  const addAll = useCallback(
    async (lines: StoreLine[]): Promise<boolean> => {
      if (!lines.length) return true;
      setState("adding");
      let ok = true;
      for (const l of lines) {
        // One at a time: each add reloads the cart.
        if (!(await addItem(l.product, l.qty, projectId))) ok = false;
      }
      setState(ok ? "added" : "failed");
      return ok;
    },
    [addItem, projectId],
  );
  return { state, addAll };
}

"use client";

// Store products for the Studio's parts, and "Add all to cart". Quantity is
// always 1 on this site: each product goes in once, raised to its minimum
// order (packs). Parts without a store product are "We'll source this".

import { useCallback, useState } from "react";

import { useCart } from "@/components/parts/cart-provider";
import { getPart } from "@/lib/studio/library";
import type { StudioComponent } from "@/lib/studio/schema";
import type { StoreCardPart } from "@/lib/store/catalog";

/** The store product sold for a library part (first published SKU), if any. */
export function productFor(partId: string, products: Map<string, StoreCardPart>): StoreCardPart | null {
  for (const sku of getPart(partId)?.storeSkus ?? []) {
    const p = products.get(sku);
    if (p) return p;
  }
  return null;
}

export const orderQty = (p: StoreCardPart) => Math.max(1, p.min_order_qty ?? 1);

/** Unique store products for the components, and the total of those. */
export function storeLines(components: StudioComponent[], products: Map<string, StoreCardPart>) {
  const seen = new Set<string>();
  const lines: StoreCardPart[] = [];
  for (const c of components) {
    const p = productFor(c.partId, products);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      lines.push(p);
    }
  }
  const total = lines.reduce((s, p) => s + Number(p.unit_price ?? 0) * orderQty(p), 0);
  return { lines, total };
}

export function useAddAllToCart(projectId: string | null) {
  const { addItem } = useCart();
  const [state, setState] = useState<"idle" | "adding" | "added" | "failed">("idle");
  const addAll = useCallback(
    async (lines: StoreCardPart[]): Promise<boolean> => {
      if (!lines.length) return true;
      setState("adding");
      let ok = true;
      for (const p of lines) {
        // One at a time: each add reloads the cart.
        if (!(await addItem(p, orderQty(p), projectId))) ok = false;
      }
      setState(ok ? "added" : "failed");
      return ok;
    },
    [addItem, projectId],
  );
  return { state, addAll };
}

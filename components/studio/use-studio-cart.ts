"use client";

// Store products for the Studio's parts, and "Add all to cart" (F-006).
//
// The plan is worked out once in lib/studio/kit-plan (every part with a
// listing, helper parts and pack listings included, packs per line), and the
// cart writes it in ONE statement: addKit for a project, addAll without one.
// It used to be a client loop calling addItem per line — each add did a session
// read, a lookup, an insert and a full cart reload, so a cut-off loop left a
// half-filled cart with no rollback (the P5-02 kit bug, which this path never
// picked up). The toast counts come back from the written plan, never from the
// list we meant to add.

import { useCallback, useState } from "react";

import { useCart } from "@/components/parts/cart-provider";
import { getPart as codeGetPart } from "@/lib/studio/library";
import { addedCounts, kitRowsFor, productForPart, type GetLibraryPart, type StudioKitPlan } from "@/lib/studio/kit-plan";
import type { StoreCardPart } from "@/lib/store/catalog";
import { packsFor } from "@/lib/store/pack";

export { studioKitPlan, addedToCartLine } from "@/lib/studio/kit-plan";
export type { StudioKitPlan, StudioKitRow } from "@/lib/studio/kit-plan";

/** The store product sold for a library part (first published SKU), if any. */
export function productFor(
  partId: string,
  products: Map<string, StoreCardPart>,
  getPart: GetLibraryPart = codeGetPart,
  /** The component's colour: its own listing first (a green LED → the green LED pack). */
  variant?: string | null,
): StoreCardPart | null {
  return productForPart(partId, products, getPart, variant);
}

/** Store listings to buy for `need` pieces of a part (packs, at least the minimum order). */
export const orderQty = (p: StoreCardPart, need = 1) => packsFor(need, p);

/** Price of `need` pieces of a part: unit price × the listings it takes. */
export const linePrice = (p: StoreCardPart, need = 1) => Number(p.unit_price ?? 0) * orderQty(p, need);

/** What the cart received: the counts the toast shows. */
export type AddedCounts = { added: number; sourced: number };

export function useStudioCart(projectId: string | null) {
  const { addKit, addAll } = useCart();
  const [state, setState] = useState<"idle" | "adding" | "added" | "failed">("idle");
  const [counts, setCounts] = useState<AddedCounts | null>(null);

  const add = useCallback(
    async (plan: StudioKitPlan): Promise<boolean> => {
      if (!plan.rows.length) return true;
      setState("adding");
      const rows = kitRowsFor(plan);
      // One insert for every row, with the kit removed again if it fails, so
      // the cart either holds the whole plan or nothing of it.
      const ok = projectId ? (await addKit(projectId, rows)) !== null : await addAll(rows);
      if (ok) setCounts(addedCounts(rows, plan));
      setState(ok ? "added" : "failed");
      return ok;
    },
    [addKit, addAll, projectId],
  );

  const dismiss = useCallback(() => setCounts(null), []);

  return { state, counts, add, dismiss };
}

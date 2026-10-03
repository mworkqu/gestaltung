"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus, ShoppingCart } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { AddedViewCart } from "@/components/parts/added-view-cart";
import { useCart } from "@/components/parts/cart-provider";

// Quantity stepper + add-to-cart for the product detail page. Products
// "available on request" use it too: they sell at the listed price and their
// delivery date is confirmed after the order (0032). After adding, the button
// becomes an "Added — View cart" link; changing the quantity brings the add
// button back so more can be added.
// Takes only the two fields it uses, so the product page never serialises the
// full row (description, specs, sourcing) into the client payload.
export function PartDetailCart({ part }: { part: Pick<Part, "id" | "min_order_qty"> }) {
  const t = useTranslations("Parts");
  const { addItem } = useCart();
  const [qty, setQty] = useState(part.min_order_qty);
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(part, qty);
    setAdded(true);
  }

  function changeQty(next: (q: number) => number) {
    setQty(next);
    setAdded(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center rounded-full bg-panel shadow-neu-inset">
        <button
          type="button"
          aria-label={t("decrease")}
          onClick={() => changeQty((q) => Math.max(part.min_order_qty, q - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-mutedtext hover:text-heading disabled:opacity-40 max-md:h-11 max-md:w-11"
          disabled={qty <= part.min_order_qty}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-10 text-center text-sm font-semibold tabular-nums text-heading">
          {qty}
        </span>
        <button
          type="button"
          aria-label={t("increase")}
          onClick={() => changeQty((q) => q + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-mutedtext hover:text-heading max-md:h-11 max-md:w-11"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div aria-live="polite" className="contents">
        {added ? (
          <AddedViewCart size="lg" />
        ) : (
          <Button type="button" size="lg" onClick={handleAdd} className="rounded-full">
            <ShoppingCart className="h-4 w-4" />
            {t("addToCart")}
          </Button>
        )}
      </div>
    </div>
  );
}

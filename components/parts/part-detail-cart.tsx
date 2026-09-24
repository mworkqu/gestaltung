"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Minus, Plus, ShoppingCart } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";

// Quantity stepper + add-to-cart for the product detail page. Products that
// are only "available on request" never render this (the page shows the
// request button instead).
export function PartDetailCart({ part }: { part: Part }) {
  const t = useTranslations("Parts");
  const { addItem } = useCart();
  const [qty, setQty] = useState(part.min_order_qty);
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(part, qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center rounded-full bg-panel shadow-neu-inset">
        <button
          type="button"
          aria-label={t("decrease")}
          onClick={() => setQty((q) => Math.max(part.min_order_qty, q - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full text-mutedtext hover:text-heading disabled:opacity-40"
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
          onClick={() => setQty((q) => q + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-mutedtext hover:text-heading"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <Button type="button" size="lg" onClick={handleAdd} className="rounded-full">
        {added ? (
          <>
            <Check className="h-4 w-4" />
            {t("added")}
          </>
        ) : (
          <>
            <ShoppingCart className="h-4 w-4" />
            {t("addToCart")}
          </>
        )}
      </Button>
    </div>
  );
}

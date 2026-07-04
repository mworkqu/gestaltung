"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { Part } from "@/lib/supabase/types";
import { useCart } from "@/components/parts/cart-provider";

// Compact "+ Add" button on a featured product card, styled per the design
// (soft accent chip). Adds the part's minimum order quantity to the cart.
export function FeaturedAddButton({ part }: { part: Part }) {
  const t = useTranslations("StoreLanding");
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const out = part.stock_status === "out_of_stock";

  function handleAdd() {
    addItem(part, part.min_order_qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      type="button"
      disabled={out}
      onClick={handleAdd}
      className="flex items-center gap-[5px] rounded-lg border border-[var(--sl-soft-border)] bg-[var(--sl-soft-bg)] px-3 py-[7px] text-[13px] font-medium text-[var(--sl-accent)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
    >
      {added ? (
        <span>{t("added")}</span>
      ) : (
        <>
          <span className="text-[15px] leading-none">+</span>
          <span>{t("addToCart")}</span>
        </>
      )}
    </button>
  );
}

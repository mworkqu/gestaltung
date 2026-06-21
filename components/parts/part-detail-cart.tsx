"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Minus, Plus, ShoppingCart, MessageCircle } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";

const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

// Quantity stepper + add-to-cart for the product detail page. When the part is
// out of stock the add button is replaced by a WhatsApp "notify me" link.
export function PartDetailCart({ part }: { part: Part }) {
  const t = useTranslations("Parts");
  const { addItem } = useCart();
  const [qty, setQty] = useState(part.min_order_qty);
  const [added, setAdded] = useState(false);

  const out = part.stock_status === "out_of_stock";

  function handleAdd() {
    addItem(part, qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  if (out) {
    const notifyText = t("notifyMessage", { sku: part.sku });
    const href = WHATSAPP_DIGITS
      ? `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(notifyText)}`
      : null;
    return (
      <div className="space-y-3">
        <Button disabled size="lg" className="w-full rounded-full sm:w-auto">
          <ShoppingCart className="h-4 w-4" />
          {t("outOfStockShort")}
        </Button>
        {href ? (
          <Button asChild variant="outline" size="lg" className="w-full rounded-full sm:w-auto">
            <a href={href} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              {t("notifyMe")}
            </a>
          </Button>
        ) : null}
      </div>
    );
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

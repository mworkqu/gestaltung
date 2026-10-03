"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { AddedViewCart } from "@/components/parts/added-view-cart";
import { useCart } from "@/components/parts/cart-provider";
import { cn } from "@/lib/utils";

// "Add to Cart" used on the product card. Adds the part's minimum order qty,
// then becomes an "Added — View cart" link until the visitor navigates away.
// Products "available on request" can be added too — they sell at the listed
// price, date confirmed after the order (0032).
export function AddToCartButton({
  part,
  className,
  size = "sm",
}: {
  part: Pick<Part, "id" | "min_order_qty">;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const t = useTranslations("Parts");
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  // aria-live announces the swap to screen readers.
  return (
    <div aria-live="polite" className="contents">
      {added ? (
        <AddedViewCart size={size} className={className} />
      ) : (
        <Button
          type="button"
          size={size}
          onClick={() => {
            addItem(part, part.min_order_qty);
            setAdded(true);
          }}
          className={cn("rounded-full", className)}
        >
          <Plus className="h-4 w-4" />
          {t("addToCart")}
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { cn } from "@/lib/utils";

// "Add to Cart" used on the product card. Adds the part's minimum order qty and
// flashes a confirmation. Products "available on request" can be added too —
// they sell at the listed price, date confirmed after the order (0032).
export function AddToCartButton({
  part,
  className,
  size = "sm",
}: {
  part: Part;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const t = useTranslations("Parts");
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(part, part.min_order_qty);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <Button
      type="button"
      size={size}
      onClick={handleAdd}
      className={cn("rounded-full", className)}
    >
      {added ? (
        <>
          <Check className="h-4 w-4" />
          {t("added")}
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          {t("addToCart")}
        </>
      )}
    </Button>
  );
}

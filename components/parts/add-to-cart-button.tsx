"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { cn } from "@/lib/utils";
import { RequestItemButton } from "@/components/parts/request-item-button";

// "Add to Cart" used on the product card. Adds the part's minimum order qty and
// flashes a confirmation. A product available on request gets the request
// button instead.
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
  // No supplier offer → no date we can promise → request it instead.
  if (!part.lead_time_class) {
    return <RequestItemButton partId={part.id} partName={part.name} size={size} className={className} />;
  }

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

"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// What "Add to Cart" turns into once the item is in the cart: a link to the
// cart. It takes focus when it appears, so a keyboard user who pressed the
// button lands on the new link instead of losing their place.
export function AddedViewCart({
  size = "sm",
  className,
}: {
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const t = useTranslations("Parts");
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <Button asChild size={size} className={cn("rounded-full", className)}>
      <Link ref={ref} href="/store/cart">
        <Check className="h-4 w-4" />
        {t("addedViewCart")}
      </Link>
    </Button>
  );
}

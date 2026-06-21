"use client";

import { useTranslations } from "next-intl";
import { ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";

// Header cart button with a live item-count badge. Always visible; links to the
// cart page.
export function CartIcon() {
  const t = useTranslations("Parts");
  const { itemCount, ready } = useCart();

  return (
    <Link
      href="/parts/cart"
      aria-label={t("cartAria", { count: itemCount })}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-mutedtext transition-colors duration-300 hover:text-heading"
    >
      <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {ready && itemCount > 0 && (
        <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cobalt px-1 text-[10px] font-bold leading-none text-white">
          {itemCount > 99 ? "99+" : itemCount}
        </span>
      )}
    </Link>
  );
}

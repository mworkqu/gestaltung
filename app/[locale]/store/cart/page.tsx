"use client";

import { useTranslations, useLocale } from "next-intl";
import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { formatPrice, partName } from "@/lib/parts/format";

export default function CartPage() {
  const t = useTranslations("Parts");
  const locale = useLocale();
  const { items, updateQty, removeItem, totalQar, ready } = useCart();

  // Avoid a hydration flash before localStorage is read.
  if (!ready) {
    return <div className="container py-16" />;
  }

  if (items.length === 0) {
    return (
      <div className="container py-12">
        <div className="neu mx-auto flex max-w-md flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <ShoppingCart className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <p className="text-base font-semibold text-heading">{t("cartEmptyTitle")}</p>
          <p className="text-sm text-mutedtext">{t("cartEmptyBody")}</p>
          <Button asChild className="rounded-full">
            <Link href="/store">{t("cartBrowse")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container space-y-8 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
        {t("cartTitle")}
      </h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Items */}
        <ul className="space-y-3">
          {items.map((item) => {
            const name =
              locale === "ar" && item.nameAr ? item.nameAr : item.name;
            return (
              <li
                key={item.sku}
                className="neu flex items-center gap-4 p-3 sm:p-4"
              >
                <Link
                  href={`/store/${item.sku}`}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-panel"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt={name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <GearPlaceholder className="h-full w-full" />
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/store/${item.sku}`}
                    className="line-clamp-1 text-sm font-semibold text-heading hover:text-cobalt"
                  >
                    {name}
                  </Link>
                  <p className="font-mono text-[11px] text-mutedtext">{item.sku}</p>
                  <p className="mt-1 text-sm font-medium text-body">
                    {formatPrice(item.unitPrice, locale)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="inline-flex items-center rounded-full bg-panel shadow-neu-inset">
                    <button
                      type="button"
                      aria-label={t("decrease")}
                      onClick={() => updateQty(item.sku, item.quantity - 1)}
                      disabled={item.quantity <= item.minOrderQty}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-mutedtext hover:text-heading disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-8 text-center text-sm font-semibold tabular-nums text-heading">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={t("increase")}
                      onClick={() => updateQty(item.sku, item.quantity + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-mutedtext hover:text-heading"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-heading">
                    {formatPrice(item.unitPrice * item.quantity, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeItem(item.sku)}
                    aria-label={t("remove")}
                    className="text-mutedtext transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Summary */}
        <aside className="neu h-fit space-y-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-bold text-heading">{t("summaryTitle")}</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mutedtext">{t("subtotal")}</span>
            <span className="font-bold tabular-nums text-heading">
              {formatPrice(totalQar, locale)}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
          <Button asChild size="lg" className="w-full rounded-full">
            <Link href="/store/checkout">{t("checkoutCta")}</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full rounded-full">
            <Link href="/store">{t("continueShopping")}</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

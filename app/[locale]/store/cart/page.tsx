"use client";

import { useTranslations, useLocale } from "next-intl";
import { Minus, Package, Plus, Trash2, ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { formatPrice } from "@/lib/parts/format";
import type { CartItem } from "@/lib/supabase/types";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { useDeliveryQuote } from "@/lib/store/use-delivery-quote";
import { formatDeliveryDate } from "@/lib/store/delivery";

// A project kit (lines sharing a kit_id) is one entry: one kit price, with its
// components listed underneath. Loose lines keep their own quantity controls.

export default function CartPage() {
  const t = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const locale = useLocale();
  const { items, updateQty, removeItem, removeKit, subtotalQar, kitDiscountQar, kitDiscountPct, totalQar, ready } =
    useCart();
  const { quote } = useDeliveryQuote(items);
  const onRequest = new Set(quote?.on_request ?? []);

  // Avoid a hydration flash before the cart is read.
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

  const nameOf = (i: CartItem) => (locale === "ar" && i.nameAr ? i.nameAr : i.name);
  const kits = new Map<string, CartItem[]>();
  for (const i of items) if (i.kitId) kits.set(i.kitId, [...(kits.get(i.kitId) ?? []), i]);
  const loose = items.filter((i) => !i.kitId);

  return (
    <div className="container space-y-8 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
        {t("cartTitle")}
      </h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <ul className="space-y-3">
          {[...kits.entries()].map(([kitId, lines]) => {
            const sum = lines.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            const price = sum - Math.round(((sum * kitDiscountPct) / 100) * 100) / 100;
            return (
              <li key={kitId} className="neu space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-panel shadow-neu-sm">
                    <Package className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-heading">
                      {t("kitTitle", { project: lines[0].projectName ?? "" })}
                    </p>
                    <p className="text-[11px] text-mutedtext">{t("kitCount", { count: lines.length })}</p>
                  </div>
                  <div className="text-end">
                    {kitDiscountPct > 0 && (
                      <p className="text-[11px] text-mutedtext line-through tabular-nums">{formatPrice(sum, locale)}</p>
                    )}
                    <p className="text-sm font-bold tabular-nums text-heading">{formatPrice(price, locale)}</p>
                    {kitDiscountPct > 0 && (
                      <p className="text-[10.5px] font-semibold text-buy">{t("kitSaving", { pct: kitDiscountPct })}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeKit(kitId)}
                    aria-label={t("removeKit")}
                    className="text-mutedtext transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ul className="divide-y divide-borderstrong/40 rounded-xl bg-panel/60 px-3 text-[12.5px]">
                  {lines.map((i) => (
                    <li key={i.rowId} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-heading">
                        {nameOf(i)} <span className="font-mono text-[10.5px] text-faint">{i.sku}</span>{" "}
                        <LeadTimeBadge leadClass={i.leadTimeClass} />
                      </span>
                      <span className="shrink-0 tabular-nums text-mutedtext">
                        × {i.quantity} · {formatPrice(i.unitPrice * i.quantity, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}

          {loose.map((item) => {
            const name = nameOf(item);
            return (
              <li key={item.rowId ?? item.sku} className="neu flex items-center gap-4 p-3 sm:p-4">
                <Link
                  href={`/store/${item.sku}`}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-panel"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={name} className="h-full w-full object-cover" />
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
                  <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-mutedtext">
                    {item.sku} <LeadTimeBadge leadClass={item.leadTimeClass} />
                  </p>
                  {onRequest.has(item.partId) && (
                    <p className="text-[11px] font-medium text-amber-700">{tD("cartOnRequest")}</p>
                  )}
                  {item.projectName && (
                    <p className="text-[11px] text-mutedtext">{t("forProject", { project: item.projectName })}</p>
                  )}
                  <p className="mt-1 text-sm font-medium text-body">{formatPrice(item.unitPrice, locale)}</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="inline-flex items-center rounded-full bg-panel shadow-neu-inset">
                    <button
                      type="button"
                      aria-label={t("decrease")}
                      onClick={() => item.rowId && updateQty(item.rowId, item.quantity - 1)}
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
                      onClick={() => item.rowId && updateQty(item.rowId, item.quantity + 1)}
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
                    onClick={() => item.rowId && removeItem(item.rowId)}
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

        <aside className="neu h-fit space-y-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-bold text-heading">{t("summaryTitle")}</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mutedtext">{t("subtotal")}</span>
            <span className="font-bold tabular-nums text-heading">{formatPrice(subtotalQar, locale)}</span>
          </div>
          {kitDiscountQar > 0 && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-mutedtext">{t("kitDiscount")}</span>
                <span className="tabular-nums text-buy">−{formatPrice(kitDiscountQar, locale)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-borderstrong/40 pt-2 text-sm">
                <span className="font-semibold text-heading">{t("total")}</span>
                <span className="font-bold tabular-nums text-heading">{formatPrice(totalQar, locale)}</span>
              </div>
            </>
          )}
          {quote?.tiers?.standard?.date && (
            <div className="rounded-xl bg-panel p-3 text-[12.5px] shadow-neu-inset">
              <p className="font-semibold text-heading">
                {tD("arrivesBy", { date: formatDeliveryDate(quote.tiers.standard.date, locale) })}
                <span className="font-normal text-mutedtext"> · {tD("tier_standard")}</span>
              </p>
              {quote.held_by && <p className="mt-1 text-mutedtext">{tD("heldBy", { item: quote.held_by })}</p>}
              <p className="mt-1 text-faint">{tD("shippingAtCheckout")}</p>
            </div>
          )}
          <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
          {onRequest.size > 0 ? (
            <p className="text-[12px] font-medium text-amber-700">{tD("cartBlocked")}</p>
          ) : (
            <Button asChild size="lg" className="w-full rounded-full">
              <Link href="/store/checkout">{t("checkoutCta")}</Link>
            </Button>
          )}
          <Button asChild variant="ghost" className="w-full rounded-full">
            <Link href="/store">{t("continueShopping")}</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

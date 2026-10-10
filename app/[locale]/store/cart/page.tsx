"use client";

import { useTranslations, useLocale } from "next-intl";
import { Minus, Package, Plus, Trash2, ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { formatPrice } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import type { CartItem } from "@/lib/supabase/types";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { useDeliveryQuote } from "@/lib/store/use-delivery-quote";
import { formatDeliveryDate, isOnRequest } from "@/lib/store/delivery";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { activeFreeShipping, freeDeliveryGap, minDeliveryFrom, qarAmount } from "@/lib/store/shipping";
import { kitDiscountQar as kitDiscountOf } from "@/lib/prototyping/kit-plan";
import { arabicCountForm } from "@/lib/text/count";
import { Skeleton } from "@/components/ui/skeleton";

// A project kit (lines sharing a kit_id) is one entry: one kit price, with its
// components listed underneath. Loose lines keep their own quantity controls.
// Lines "available on request" can be checked out at their listed price; their
// delivery date is to be confirmed after the order (0032).

/** Same grid as the loaded cart: title, a few line cards, the summary card. */
function CartSkeleton() {
  return (
    <div className="container space-y-6 py-6 sm:space-y-8 sm:py-8" aria-busy="true">
      <Skeleton className="h-8 w-40 sm:h-9" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ul className="min-w-0 space-y-3">
          {[0, 1, 2].map((n) => (
            <li key={n} className="neu flex min-w-0 items-center gap-4 p-3 sm:p-4">
              <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            </li>
          ))}
        </ul>
        <aside className="neu h-fit min-w-0 space-y-4 p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-11 w-full rounded-full" />
        </aside>
      </div>
    </div>
  );
}

export default function CartPage() {
  const t = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const tC = useTranslations("Cart");
  const locale = useLocale();
  const { items, updateQty, removeItem, removeKit, subtotalQar, kitDiscountQar, kitDiscountPct, totalQar, ready, stale, error, retry } =
    useCart();
  const { quote } = useDeliveryQuote(items);
  const toConfirm = (i: CartItem) => isOnRequest(i, quote ? quote.on_request : null);

  // Until the first read finishes (or the last-known cart is on hand) show the
  // layout as a skeleton: never "QAR 0.00" or an empty-cart message.
  if (!ready && !stale) return <CartSkeleton />;

  // A failed read or write: say so; never an empty cart that is not empty (#3).
  const errorBar = error && (
    <div role="alert" className="neu flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-destructive">
      <span>{tC(error === "save" ? "saveError" : "loadError")}</span>
      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => void retry()}>
        {tC("retry")}
      </Button>
    </div>
  );
  if (error && items.length === 0) return <div className="container py-12">{errorBar}</div>;

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
  const anyToConfirm = items.some(toConfirm);
  const standardDate = quote?.tiers?.standard?.date ?? null;
  // Delivery cost before checkout (0044). The cart total is the goods subtotal
  // (after the kit discount, before shipping), the same figure the server uses.
  const deliveryFrom = minDeliveryFrom(quote?.tiers);
  const freeShipping = activeFreeShipping(quote?.free_shipping);
  const freeGap = freeDeliveryGap(totalQar, freeShipping);

  return (
    <div className="container space-y-6 py-6 sm:space-y-8 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
        {t("cartTitle")}
      </h1>
      {errorBar}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ul className="min-w-0 space-y-3">
          {[...kits.entries()].map(([kitId, lines]) => {
            const sum = lines.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            const price = sum - kitDiscountOf(sum, kitDiscountPct);
            return (
              <li key={kitId} className="neu min-w-0 space-y-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-panel shadow-neu-sm">
                    <Package className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-heading">
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
                    className="tap-icon rounded-full text-mutedtext transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ul className="divide-y divide-borderstrong/40 rounded-xl bg-panel/60 px-3 text-[12.5px]">
                  {lines.map((i) => (
                    <li key={i.rowId} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-heading">
                        <IsolatedTitle text={nameOf(i)} locale={locale} /> <LeadTimeBadge leadClass={i.leadTimeClass} />
                        {toConfirm(i) && <span className="ms-1 text-[10.5px] text-mutedtext">{tD("dateTbc")}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-mutedtext">
                        {(i.packSize ?? 1) > 1 ? t("cartPacks", { n: i.quantity, count: String(i.quantity), form: arabicCountForm(i.quantity), size: String(i.packSize ?? 1) }) : `× ${i.quantity}`} ·{" "}
                        {formatPrice(i.unitPrice * i.quantity, locale)}
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
              <li key={item.rowId ?? item.sku} className="neu flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:flex-nowrap sm:p-4">
                <Link
                  href={`/store/${item.sku}`}
                  className="block aspect-square h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-panel"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sizedImage(item.imageUrl, IMAGE_WIDTHS.thumb)!}
                      width={64}
                      height={64}
                      alt={name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <GearPlaceholder className="h-full w-full" />
                  )}
                </Link>

                <div className="min-w-0 flex-1 basis-40">
                  <Link
                    href={`/store/${item.sku}`}
                    className="line-clamp-2 break-words text-sm font-semibold text-heading hover:text-cobalt max-md:min-h-11 sm:line-clamp-1"
                    title={name}
                  >
                    <IsolatedTitle text={name} locale={locale} />
                  </Link>
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-mutedtext">
                    <LeadTimeBadge leadClass={item.leadTimeClass} />
                  </p>
                  {toConfirm(item) && (
                    <p className="text-[11px] font-medium text-mutedtext">{tD("dateTbc")}</p>
                  )}
                  {item.projectName && (
                    <p className="text-[11px] text-mutedtext">{t("forProject", { project: item.projectName })}</p>
                  )}
                  <p className="mt-1 text-sm font-medium text-body">
                    {formatPrice(item.unitPrice, locale)}
                    {(item.packSize ?? 1) > 1 && (
                      <span className="ms-1 text-[11px] font-normal text-mutedtext">{t("cartPerPack", { size: String(item.packSize ?? 1) })}</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                  <div className="inline-flex items-center rounded-full bg-panel shadow-neu-inset">
                    <button
                      type="button"
                      aria-label={t("decrease")}
                      onClick={() => item.rowId && updateQty(item.rowId, item.quantity - 1)}
                      disabled={item.quantity <= item.minOrderQty}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-mutedtext hover:text-heading disabled:opacity-40 max-md:h-11 max-md:w-11"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-8 text-center text-sm font-semibold tabular-nums text-heading max-md:min-w-10">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={t("increase")}
                      onClick={() => item.rowId && updateQty(item.rowId, item.quantity + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-mutedtext hover:text-heading max-md:h-11 max-md:w-11"
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
                    className="tap-icon rounded-full text-mutedtext transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="neu h-fit min-w-0 space-y-4 p-5 lg:sticky lg:top-24">
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
          <div className="space-y-1 text-[12.5px]">
            {freeShipping && freeGap === 0 ? (
              <p className="font-semibold text-buy">
                {tD("freeDelivery")}
                <span className="font-normal text-mutedtext">
                  {" "}
                  · {freeShipping.tiers.map((k) => tD(`tier_${k}`)).join(" / ")}
                </span>
              </p>
            ) : (
              deliveryFrom !== null && (
                <p className="text-body">{tD("deliveryFromCart", { min: qarAmount(deliveryFrom) })}</p>
              )
            )}
            {freeGap !== null && freeGap > 0 && (
              <p className="font-medium text-heading">{tD("freeDeliveryGap", { n: freeGap })}</p>
            )}
            <p className="text-faint">{tD("shippingAtCheckout")}</p>
          </div>
          {(standardDate || anyToConfirm) && (
            <div className="rounded-xl bg-panel p-3 text-[12.5px] shadow-neu-inset">
              {standardDate && (
                <p className="font-semibold text-heading">
                  {tD("arrivesBy", { date: formatDeliveryDate(standardDate, locale) })}
                  <span className="font-normal text-mutedtext"> · {tD("tier_standard")}</span>
                </p>
              )}
              {quote?.held_by && <p className="mt-1 text-mutedtext">{tD("heldBy", { item: quote.held_by })}</p>}
              {anyToConfirm && <p className="mt-1 text-mutedtext">{tD("tbcNote")}</p>}
            </div>
          )}
          <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
          {stale && !ready ? (
            // Lines are the last known cart; checkout waits for the real read.
            <Button size="lg" className="w-full rounded-full" disabled aria-busy="true">
              {t("checkoutCta")}
            </Button>
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

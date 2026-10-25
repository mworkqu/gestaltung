"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { formatPrice } from "@/lib/parts/format";
import { formatDeliveryDate, type ShippingTier } from "@/lib/store/delivery";
import { arabicCountForm } from "@/lib/text/count";
import type { CartItem } from "@/lib/supabase/types";

/** The checkout's side panel: lines, discounts, delivery and the total. */
export function OrderSummary({
  items,
  toConfirm,
  kitDiscountQar,
  creditQar,
  creditExpiry,
  hasCredits,
  tier,
  doSplit,
  shippingFree,
  shippingQar,
  handlingQar,
  grandTotal,
  promisedDate,
}: {
  items: CartItem[];
  /** Line is "available on request" (date to be confirmed). */
  toConfirm: (i: CartItem) => boolean;
  kitDiscountQar: number;
  creditQar: number;
  /** credit_summary.next_expiry. */
  creditExpiry: string | null;
  /** A credit summary has loaded. */
  hasCredits: boolean;
  tier: ShippingTier;
  doSplit: boolean;
  /** The quote has loaded and the chosen tier ships free. */
  shippingFree: boolean;
  shippingQar: number;
  handlingQar: number;
  grandTotal: number;
  promisedDate: string | null | undefined;
}) {
  const t = useTranslations("Checkout");
  const tParts = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const tCr = useTranslations("Credits");
  const locale = useLocale();

  return (
    <aside className="neu h-fit space-y-4 p-5 lg:sticky lg:top-24">
      <h2 className="text-sm font-bold text-heading">{t("summaryTitle")}</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.rowId ?? i.sku} className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-body">
              <IsolatedTitle text={locale === "ar" && i.nameAr ? i.nameAr : i.name} locale={locale} />
              <span className="text-mutedtext">
                {" "}
                {(i.packSize ?? 1) > 1
                  ? `· ${tParts("cartPacks", { n: i.quantity, count: String(i.quantity), form: arabicCountForm(i.quantity), size: String(i.packSize ?? 1) })}`
                  : `× ${i.quantity}`}
              </span>
              {toConfirm(i) ? (
                <span className="block text-[11px] text-faint">{tD("dateTbc")}</span>
              ) : (
                i.leadTimeClass && (
                  <span className="block text-[11px] text-faint">{tD(`lt_${i.leadTimeClass}`)}</span>
                )
              )}
            </span>
            <span className="shrink-0 tabular-nums text-heading">
              {formatPrice(i.unitPrice * i.quantity, locale)}
            </span>
          </li>
        ))}
      </ul>
      {kitDiscountQar > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-mutedtext">{tParts("kitDiscount")}</span>
          <span className="tabular-nums text-buy">−{formatPrice(kitDiscountQar, locale)}</span>
        </div>
      )}
      {creditQar > 0 && hasCredits && (
        <div className="space-y-0.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-mutedtext">{tCr("checkoutLine")}</span>
            <span className="tabular-nums text-buy">−{formatPrice(creditQar, locale)}</span>
          </div>
          {creditExpiry && (
            <p className="text-[11px] text-faint">
              {tCr("checkoutExpiry", {
                date: new Date(creditExpiry).toLocaleDateString(locale === "ar" ? "ar-QA" : "en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              })}{" "}
              <Link href="/pricing#credits" className="font-semibold text-cobalt hover:underline">
                {tCr("howCreditsLink")}
              </Link>
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-mutedtext">
          {tD("shippingLine", { tier: tD(`tier_${tier}`) })}
          {doSplit && " × 2"}
        </span>
        <span className="tabular-nums text-heading">
          {shippingFree ? tD("freeDelivery") : formatPrice(shippingQar, locale)}
        </span>
      </div>
      {handlingQar > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-mutedtext">{tD("handlingLine")}</span>
          <span className="tabular-nums text-heading">{formatPrice(handlingQar, locale)}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-borderstrong/40 pt-3 text-sm">
        <span className="font-semibold text-heading">{t("total")}</span>
        <span className="font-bold tabular-nums text-heading">
          {formatPrice(grandTotal, locale)}
        </span>
      </div>
      {promisedDate && (
        <p className="text-[12.5px] font-semibold text-heading">
          {tD("arrivesBy", { date: formatDeliveryDate(promisedDate, locale) })}
        </p>
      )}
      <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
    </aside>
  );
}

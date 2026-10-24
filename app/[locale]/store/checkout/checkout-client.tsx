"use client";

import { useEffect, useRef, useState } from "react";
import { METHOD_ICON, PaymentInstructions } from "@/components/payment/payment-instructions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/company";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/parts/format";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/lib/supabase/types";
import { useDeliveryQuote } from "@/lib/store/use-delivery-quote";
import { creditsChanged, useCreditSummary } from "@/lib/credits/use-credits";
import {
  formatDeliveryDate,
  isOnRequest,
  type ShippingTier,
} from "@/lib/store/delivery";
import {
  checkoutGoodsQar,
  checkoutTotals,
  displayedTiers,
  isZeroTotal,
  pricedTiers,
  selectableTier,
} from "@/lib/store/checkout-totals";
import {
  checkoutBlocked,
  EMAIL_FIELD_ERRORS,
  placeOrder,
  quoteOnRequestIds,
  readOrderFields,
  type PlaceOrderError,
} from "@/lib/store/place-order";
import { useClassOrderId } from "@/lib/schools/client";
import { CustomerFields, FieldLabel, fieldClass, monoClass } from "./customer-fields";
import { OrderSummary } from "./order-summary";

// The form itself; page.tsx (server) sends an empty cart to /store/cart first.
// Money comes from lib/store/checkout-totals, the order from lib/store/place-order;
// this file is the state and the wiring.
export default function CheckoutClient() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const { items, totalQar, kitDiscountQar, clearCart, ready } = useCart();
  const tD = useTranslations("Delivery");
  const tPay = useTranslations("PayMethods");
  const tPhone = useTranslations("Phone");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash_on_delivery");
  // 3e: a teacher's class order (?class=<id>). The quote then comes from
  // class_order_delivery_quote (Economy at QAR 0), the tier starts on Economy,
  // and the id goes to create_part_order, which checks it is their own class.
  const classOrderId = useClassOrderId();
  const { quote, legacy, error: quoteError } = useDeliveryQuote(items, classOrderId);
  const [pickedTier, setTier] = useState<ShippingTier>("standard");
  const classTierSet = useRef(false);
  useEffect(() => {
    if (classOrderId && !classTierSet.current) {
      classTierSet.current = true;
      setTier("economy");
    }
  }, [classOrderId]);
  const [split, setSplit] = useState(false);
  // AI credits spent in the last 30 days come back as one discount (0042); the
  // server applies it (redeem_credits) right after the order is created.
  const credits = useCreditSummary();
  // Same-price tiers: only the fastest is shown (F-014), and the picked tier
  // falls back to the shown one with its price, so what is submitted is always
  // a tier on screen.
  const offered = pricedTiers(quote, checkoutGoodsQar(quote, totalQar), split && Boolean(quote?.can_split));
  const shownTiers = displayedTiers(offered);
  const tier = selectableTier(pickedTier, offered, shownTiers);
  // The server quote decides the price (0044); see lib/store/checkout-totals.
  const totals = checkoutTotals({ quote, cartTotalQar: totalQar, tier, split, credits });
  const { canSplit, doSplit, priceOf, shippingQar, handlingQar, splitExtraQar, creditQar, grandTotal } = totals;
  const chosen = quote?.tiers[tier];
  // "Available on request" lines are sold at the listed price with the date to
  // be confirmed (0032); they no longer block checkout. Only a missing quote does.
  const onRequestIds = quoteOnRequestIds(quote);
  const toConfirm = (i: CartItem) => isOnRequest(i, onRequestIds);
  const anyToConfirm = items.some(toConfirm);
  const blocked = checkoutBlocked(quote, tier, legacy);

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bankTransfer = payMethod === "bank_transfer";

  // Fallback for the server redirect in page.tsx: if the cart turns out empty
  // once read on the client, go to the cart. Not while an order is being
  // placed: clearCart() empties it just before the success page.
  useEffect(() => {
    if (ready && items.length === 0 && !submitting) {
      router.replace("/store/cart");
    }
  }, [ready, items.length, submitting, router]);

  // Funnel (P1-08): once per visit, when the cart has loaded with lines in it.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!ready || items.length === 0 || startedRef.current) return;
    startedRef.current = true;
    track("checkout_started", { items: items.length, total_qar: totalQar });
  }, [ready, items.length, totalQar]);

  const mono = (extra = "") => monoClass(isRtl, extra);

  const message = (e: PlaceOrderError): string =>
    e === "phoneInvalid"
      ? tPhone("invalid")
      : e === "quoteError" || e === "errorNoDate" || e === "cartBlocked"
        ? tD(e)
        : t(e);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEmailError(null);

    const fields = readOrderFields(new FormData(e.currentTarget));
    const result = await placeOrder(
      {
        supabase: createClient(),
        storage: () => window.sessionStorage,
        onPlacing: () => setSubmitting(true),
        onCreditsApplied: creditsChanged,
      },
      {
        fields,
        items,
        payMethod,
        tier,
        split: doSplit,
        quote,
        legacy,
        quoteError,
        classOrderId,
        totals: { grandTotal, creditQar, shippingQar, handlingQar },
      }
    );

    if (!result.ok) {
      setSubmitting(false);
      if (EMAIL_FIELD_ERRORS.includes(result.error)) setEmailError(message(result.error));
      else setError(message(result.error));
      return;
    }

    const { orderId, placedTotal } = result;

    // Confirmation email with the promised date(s); sent once, server-side.
    void fetch("/api/orders/confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, locale }),
      keepalive: true,
    }).catch(() => {});

    track("order_placed", { order_id: orderId, total_qar: placedTotal, method: payMethod });
    clearCart();
    router.push({ pathname: "/store/checkout/success", query: { order: orderId } });
  }

  if (!ready) return <div className="container py-16" />;

  return (
    <div className="container space-y-8 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
        {t("title")}
      </h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={handleSubmit} className="neu space-y-5 p-5 sm:p-6">
          <CustomerFields
            isRtl={isRtl}
            bankTransfer={bankTransfer}
            emailError={emailError}
            onEmailInput={() => setEmailError(null)}
          />

          <fieldset className="space-y-2">
            <legend className={mono("block text-[10px] text-mutedtext")}>{tD("shippingLabel")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {shownTiers.map(({ tier: k }) => {
                const q = quote!.tiers[k]!;
                const price = priceOf(k);
                return (
                  <label
                    key={k}
                    className={cn(
                      "cursor-pointer rounded-xl border bg-panel p-3 text-sm shadow-neu-sm transition",
                      tier === k ? "border-cobalt ring-2 ring-cobalt/40" : "border-white/60"
                    )}
                  >
                    <input type="radio" name="tier" value={k} checked={tier === k} onChange={() => setTier(k)} className="sr-only" />
                    <span className="block font-semibold text-heading">{tD(`tier_${k}`)}</span>
                    <span className={cn("block tabular-nums", price.free ? "font-semibold text-buy" : "text-body")}>
                      {price.free ? tD("freeDelivery") : formatPrice(price.shippingQar, locale)}
                    </span>
                    <span className="block text-[12px] text-mutedtext">
                      {q.date ? tD("arrivesBy", { date: formatDeliveryDate(q.date, locale) }) : tD("dateTbc")}
                    </span>
                  </label>
                );
              })}
            </div>
            {quote?.held_by && (
              <div className="rounded-xl bg-panel p-3 text-[12.5px] shadow-neu-inset">
                <p className="text-body">
                  {doSplit
                    ? tD("splitSummary", {
                        early: formatDeliveryDate(chosen?.early_date, locale),
                        late: formatDeliveryDate(chosen?.date, locale),
                      })
                    : tD("oneShipment", { date: formatDeliveryDate(chosen?.date, locale), item: quote.held_by })}
                </p>
                {canSplit && (
                  <label className="mt-2 flex items-center gap-2 text-heading">
                    <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
                    {splitExtraQar > 0
                      ? tD("splitOption", { cost: formatPrice(splitExtraQar, locale) })
                      : tD("splitOptionFree")}
                  </label>
                )}
              </div>
            )}
            {anyToConfirm && <p className="text-[12px] text-mutedtext">{tD("tbcNote")}</p>}
            {quoteError && <p className="text-[12px] font-medium text-destructive">{tD("quoteError")}</p>}
            <p className="text-[11px] text-faint">
              {tD("promiseNote")}
              {quote?.working_days && <> {tD("workingDaysNote")}</>}
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={mono("block text-[10px] text-mutedtext")}>{tPay("label")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PAYMENT_METHODS.map((m) => {
                const Icon = METHOD_ICON[m];
                return (
                  <label
                    key={m}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border bg-panel p-3 text-sm shadow-neu-sm transition",
                      payMethod === m ? "border-cobalt ring-2 ring-cobalt/40" : "border-white/60"
                    )}
                  >
                    <input type="radio" name="payment_method" value={m} checked={payMethod === m} onChange={() => setPayMethod(m)} className="sr-only" />
                    <Icon className="h-4 w-4 shrink-0 text-cobalt" />
                    <span className="font-semibold text-heading">{tPay(`${m}_title`)}</span>
                  </label>
                );
              })}
            </div>
            <PaymentInstructions method={payMethod} amount={formatPrice(grandTotal, locale)} />
            <p className="text-[11px] text-faint">{tPay("methodsLine")}</p>
          </fieldset>

          <div className="space-y-2">
            <FieldLabel htmlFor="delivery_notes" text={t("notesLabel")} isRtl={isRtl} />
            <textarea
              id="delivery_notes"
              name="delivery_notes"
              rows={3}
              placeholder={t("notesPlaceholder")}
              className={cn(fieldClass, "resize-y")}
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" size="lg" disabled={submitting || blocked || isZeroTotal(grandTotal)} className="rounded-full">
              {submitting && <Loader2 className="animate-spin" />}
              {t("placeOrder")}
            </Button>
            <Button asChild variant="ghost" className="rounded-full">
              <Link href="/store/cart">{t("backToCart")}</Link>
            </Button>
          </div>
        </form>

        <OrderSummary
          items={items}
          toConfirm={toConfirm}
          kitDiscountQar={kitDiscountQar}
          creditQar={creditQar}
          creditExpiry={credits?.next_expiry ?? null}
          hasCredits={Boolean(credits)}
          tier={tier}
          doSplit={doSplit}
          shippingFree={Boolean(quote && priceOf(tier).free)}
          shippingQar={shippingQar}
          handlingQar={handlingQar}
          grandTotal={grandTotal}
          promisedDate={chosen?.date}
        />
      </div>
    </div>
  );
}

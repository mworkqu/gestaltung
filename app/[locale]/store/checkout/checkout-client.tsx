"use client";

import { useEffect, useState } from "react";
import { METHOD_ICON, PaymentInstructions } from "@/components/payment/payment-instructions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/company";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS, LAST_ORDER_KEY } from "@/lib/parts/constants";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/lib/supabase/types";
import { useDeliveryQuote } from "@/lib/store/use-delivery-quote";
import { isValidPhone } from "@/lib/phone";
import { creditsChanged, useCreditSummary } from "@/lib/credits/use-credits";
import {
  formatDeliveryDate,
  isOnRequest,
  SHIPPING_TIERS,
  type ShippingTier,
} from "@/lib/store/delivery";
import { shippingFor } from "@/lib/store/shipping";
import { checkoutRpcError, validateCheckoutEmail } from "@/lib/store/checkout";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

// The form itself; page.tsx (server) sends an empty cart to /store/cart first.
export default function CheckoutClient() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const { items, totalQar, kitDiscountQar, clearCart, ready } = useCart();
  const tParts = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const tPay = useTranslations("PayMethods");
  const tPhone = useTranslations("Phone");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash_on_delivery");
  const { quote, legacy, error: quoteError } = useDeliveryQuote(items);
  const [tier, setTier] = useState<ShippingTier>("standard");
  const [split, setSplit] = useState(false);
  const canSplit = Boolean(quote?.can_split);
  const doSplit = split && canSplit;
  // The server quote decides the price (0044): the same goods subtotal and
  // free-delivery rule create_part_order charges. Before 0044 the quote has no
  // free_shipping and the cart total stands in for the goods subtotal.
  const goodsQar = quote?.free_shipping?.goods_qar ?? totalQar;
  const priceOf = (k: ShippingTier) =>
    quote
      ? shippingFor({
          tier: k,
          goodsQar,
          tiers: quote.tiers,
          handlingFeeQar: quote.handling_fee_qar,
          freeShipping: quote.free_shipping,
          split: doSplit,
        })
      : { shippingQar: 0, handlingQar: 0, free: false };
  const { shippingQar, handlingQar } = priceOf(tier);
  // Extra delivery cost of splitting into two shipments (0 when delivery is free).
  const splitExtraQar = quote
    ? shippingFor({ tier, goodsQar, tiers: quote.tiers, freeShipping: quote.free_shipping }).shippingQar
    : 0;
  // AI credits spent in the last 30 days come back as one discount (0042),
  // capped at the goods subtotal. The server applies it (redeem_credits) right
  // after the order is created; this is the same figure, shown in advance.
  const credits = useCreditSummary();
  const tCr = useTranslations("Credits");
  const creditQar = credits ? Math.min(credits.redeemable_qar, Math.max(totalQar, 0)) : 0;
  const grandTotal = Math.round((totalQar - creditQar + shippingQar + handlingQar) * 100) / 100;
  const chosen = quote?.tiers[tier];
  // "Available on request" lines are sold at the listed price with the date to
  // be confirmed (0032); they no longer block checkout. Only a missing quote does.
  const onRequestIds = quote ? quote.on_request ?? [] : null;
  const toConfirm = (i: CartItem) => isOnRequest(i, onRequestIds);
  const anyToConfirm = items.some(toConfirm);
  const blocked = !legacy && (!quote || !chosen);

  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [areaOther, setAreaOther] = useState(false);
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

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const label = (htmlFor: string, text: string, required = false) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
      {required && <span className="text-destructive"> *</span>}
    </label>
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEmailError(null);

    const form = new FormData(e.currentTarget);
    const customerName = String(form.get("customer_name") ?? "").trim();
    const customerPhone = String(form.get("customer_phone") ?? "").trim();
    const customerEmail = String(form.get("customer_email") ?? "").trim();
    const deliveryArea = String(form.get("delivery_area") ?? "").trim();
    const deliveryNotes = String(form.get("delivery_notes") ?? "").trim();

    if (!customerName || !customerPhone || !deliveryArea) {
      setError(t("errorRequired"));
      return;
    }
    if (!isValidPhone(customerPhone)) {
      setError(tPhone("invalid"));
      return;
    }
    const emailProblem = validateCheckoutEmail(customerEmail, payMethod);
    if (emailProblem) {
      setEmailError(t(emailProblem === "emailRequiredBank" ? "errorEmailBank" : "errorEmailInvalid"));
      return;
    }
    if (items.length === 0) {
      setError(t("errorEmpty"));
      return;
    }
    if (blocked) {
      setError(quoteError ? tD("quoteError") : tD("errorNoDate"));
      return;
    }
    if (grandTotal <= 0) {
      setError(t("errorTotalZero"));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const orderArgs = {
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail || null,
      p_delivery_area: deliveryArea,
      p_delivery_notes: deliveryNotes || null,
      // Project, BOM lines and kit let the server price kits and mark the
      // project's lines bought (0025); older databases ignore the extra keys.
      p_items: items.map((i) => ({
        part_id: i.partId,
        quantity: i.quantity,
        project_id: i.projectId ?? null,
        bom_lines: i.bomLines ?? [],
        kit_id: i.kitId ?? null,
      })),
      // Before migration 0029 the RPC has no shipping parameters.
      ...(legacy ? {} : { p_shipping_tier: tier, p_split: doSplit }),
    };
    // The payment method goes in with the order (0044) so a bank transfer
    // without an email is refused before any order exists. A database
    // without 0044 has no such parameter (PGRST202): place it without.
    let { data, error: rpcError } = await supabase.rpc(
      "create_part_order",
      legacy ? orderArgs : { ...orderArgs, p_payment_method: payMethod }
    );
    if (rpcError?.code === "PGRST202" && !legacy) {
      ({ data, error: rpcError } = await supabase.rpc("create_part_order", orderArgs));
    }

    if (rpcError || !data) {
      setSubmitting(false);
      // A database without 0032 still refuses on-request items; 0044 refuses a
      // bank transfer without an email and an order with nothing to pay.
      const key = checkoutRpcError(rpcError?.message);
      if (key === "emailRequiredBank") setEmailError(t("errorEmailBank"));
      else setError(key === "cartBlocked" ? tD("cartBlocked") : key === "totalZero" ? t("errorTotalZero") : t("errorSubmit"));
      return;
    }

    const orderId = data as string;

    // Apply redeemable AI credits to this order (0042). The server decides the
    // amount; before 0042 the call fails and nothing is applied.
    const { data: applied } = await supabase.rpc("redeem_credits", { p_order: orderId }).then(
      (r) => r,
      () => ({ data: 0 })
    );
    const appliedQar = Number(applied) || 0;
    const placedTotal = Math.round((grandTotal + creditQar - appliedQar) * 100) / 100;
    if (appliedQar > 0) creditsChanged();

    // Record how they'll pay (0039). Since 0044 create_part_order has already
    // stored it and this is a no-op; before 0039 the call fails and the order
    // simply has no method; the success page still shows the choice.
    await supabase.rpc("set_order_payment_method", { p_order: orderId, p_method: payMethod }).then(
      () => {},
      () => {}
    );

    // Snapshot the order for the (guest-safe) success page — a guest can't read
    // their own order back through RLS.
    try {
      window.sessionStorage.setItem(
        LAST_ORDER_KEY,
        JSON.stringify({
          id: orderId,
          customerName,
          total: placedTotal,
          shippingQar,
          handlingQar,
          tier,
          split: doSplit,
          promisedDate: chosen?.date ?? null,
          earlyDate: doSplit ? chosen?.early_date ?? null : null,
          heldBy: quote?.held_by ?? null,
          hasOnRequest: anyToConfirm,
          paymentMethod: payMethod,
          items: items.map((i) => ({
            sku: i.sku,
            name: i.name,
            nameAr: i.nameAr,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            leadTimeClass: i.leadTimeClass ?? null,
            onRequest: toConfirm(i),
          })),
        })
      );
    } catch {
      // sessionStorage unavailable — the success page falls back gracefully.
    }

    // Confirmation email with the promised date(s); sent once, server-side.
    void fetch("/api/orders/confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, locale }),
      keepalive: true,
    }).catch(() => {});

    clearCart();
    router.push({ pathname: "/store/checkout/success", query: { order: orderId } });
  }

  if (!ready) return <div className="container py-16" />;

  return (
    <div className="container space-y-8 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
        {t("title")}
      </h1>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <form onSubmit={handleSubmit} className="neu space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            {label("customer_name", t("nameLabel"), true)}
            <input id="customer_name" name="customer_name" required className={fieldClass} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              {label("customer_phone", t("phoneLabel"), true)}
              <input
                id="customer_phone"
                name="customer_phone"
                required
                inputMode="tel"
                placeholder={t("phonePlaceholder")}
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              {bankTransfer
                ? label("customer_email", t("emailLabelRequired"), true)
                : label("customer_email", t("emailLabel"))}
              <input
                id="customer_email"
                name="customer_email"
                type="email"
                required={bankTransfer}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "customer_email_error" : bankTransfer ? "customer_email_hint" : undefined}
                onChange={() => emailError && setEmailError(null)}
                className={cn(fieldClass, emailError && "ring-2 ring-destructive/60")}
              />
              {emailError && (
                <p id="customer_email_error" role="alert" className="text-[12px] font-medium text-destructive">
                  {emailError}
                </p>
              )}
              {bankTransfer && (
                <p id="customer_email_hint" className="text-[11px] text-mutedtext">
                  {tPay("emailForBank")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {label("delivery_area", t("areaLabel"), true)}
            <select
              id="delivery_area"
              name="delivery_area"
              required
              defaultValue=""
              onChange={(e) => setAreaOther(e.target.value === "other")}
              aria-describedby={areaOther ? "delivery_area_hint" : undefined}
              className={cn(fieldClass, isRtl && "text-right")}
            >
              <option value="" disabled>
                {t("areaPlaceholder")}
              </option>
              {DELIVERY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {t(`area_${a}`)}
                </option>
              ))}
            </select>
            {areaOther && (
              <p id="delivery_area_hint" className="text-[11px] text-mutedtext">
                {t("areaOtherHint")}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className={mono("block text-[10px] text-mutedtext")}>{tD("shippingLabel")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {SHIPPING_TIERS.filter((k) => quote?.tiers[k]).map((k) => {
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
            <p className="text-[11px] text-faint">{tD("promiseNote")}</p>
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
            <p className="text-[11px] text-faint">{tPay("cardSoon")}</p>
          </fieldset>

          <div className="space-y-2">
            {label("delivery_notes", t("notesLabel"))}
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
            <Button type="submit" size="lg" disabled={submitting || blocked || grandTotal <= 0} className="rounded-full">
              {submitting && <Loader2 className="animate-spin" />}
              {t("placeOrder")}
            </Button>
            <Button asChild variant="ghost" className="rounded-full">
              <Link href="/store/cart">{t("backToCart")}</Link>
            </Button>
          </div>
        </form>

        {/* Order summary */}
        <aside className="neu h-fit space-y-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-bold text-heading">{t("summaryTitle")}</h2>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.rowId ?? i.sku} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-body">
                  {(locale === "ar" && i.nameAr ? i.nameAr : i.name)}
                  <span className="text-mutedtext"> × {i.quantity}</span>
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
          {creditQar > 0 && credits && (
            <div className="space-y-0.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-mutedtext">{tCr("checkoutLine")}</span>
                <span className="tabular-nums text-buy">−{formatPrice(creditQar, locale)}</span>
              </div>
              {credits.next_expiry && (
                <p className="text-[11px] text-faint">
                  {tCr("checkoutExpiry", {
                    date: new Date(credits.next_expiry).toLocaleDateString(locale === "ar" ? "ar-QA" : "en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  })}
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
              {quote && priceOf(tier).free ? tD("freeDelivery") : formatPrice(shippingQar, locale)}
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
          {chosen?.date && (
            <p className="text-[12.5px] font-semibold text-heading">
              {tD("arrivesBy", { date: formatDeliveryDate(chosen.date, locale) })}
            </p>
          )}
          <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
        </aside>
      </div>
    </div>
  );
}

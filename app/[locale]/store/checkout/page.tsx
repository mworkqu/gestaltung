"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/parts/format";
import { DELIVERY_AREAS, LAST_ORDER_KEY } from "@/lib/parts/constants";
import { cn } from "@/lib/utils";
import { useDeliveryQuote } from "@/lib/store/use-delivery-quote";
import { formatDeliveryDate, shippingTotal, SHIPPING_TIERS, type ShippingTier } from "@/lib/store/delivery";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export default function CheckoutPage() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const { items, totalQar, kitDiscountQar, clearCart, ready } = useCart();
  const tParts = useTranslations("Parts");
  const tD = useTranslations("Delivery");
  const { quote, legacy } = useDeliveryQuote(items);
  const [tier, setTier] = useState<ShippingTier>("standard");
  const [split, setSplit] = useState(false);
  const canSplit = Boolean(quote?.can_split);
  const doSplit = split && canSplit;
  const shippingQar = quote ? shippingTotal(quote, tier, doSplit) : 0;
  const handlingQar = quote?.handling_fee_qar ?? 0;
  const grandTotal = Math.round((totalQar + shippingQar + handlingQar) * 100) / 100;
  const chosen = quote?.tiers[tier];
  const blocked = !legacy && (!quote || (quote.on_request?.length ?? 0) > 0 || !chosen?.date);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the cart is empty (e.g. after a refresh post-checkout), bounce to /store.
  useEffect(() => {
    if (ready && items.length === 0 && !submitting) {
      router.replace("/store");
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
    if (items.length === 0) {
      setError(t("errorEmpty"));
      return;
    }
    if (blocked) {
      setError(tD("errorNoDate"));
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { data, error: rpcError } = await supabase.rpc("create_part_order", {
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
    });

    if (rpcError || !data) {
      setSubmitting(false);
      setError(t("errorSubmit"));
      return;
    }

    const orderId = data as string;

    // Snapshot the order for the (guest-safe) success page — a guest can't read
    // their own order back through RLS.
    try {
      window.sessionStorage.setItem(
        LAST_ORDER_KEY,
        JSON.stringify({
          id: orderId,
          customerName,
          total: grandTotal,
          shippingQar,
          handlingQar,
          tier,
          split: doSplit,
          promisedDate: chosen?.date ?? null,
          earlyDate: doSplit ? chosen?.early_date ?? null : null,
          heldBy: quote?.held_by ?? null,
          items: items.map((i) => ({
            sku: i.sku,
            name: i.name,
            nameAr: i.nameAr,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            leadTimeClass: i.leadTimeClass ?? null,
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
              {label("customer_email", t("emailLabel"))}
              <input
                id="customer_email"
                name="customer_email"
                type="email"
                className={fieldClass}
              />
            </div>
          </div>

          <div className="space-y-2">
            {label("delivery_area", t("areaLabel"), true)}
            <select
              id="delivery_area"
              name="delivery_area"
              required
              defaultValue=""
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
          </div>

          <fieldset className="space-y-2">
            <legend className={mono("block text-[10px] text-mutedtext")}>{tD("shippingLabel")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {SHIPPING_TIERS.filter((k) => quote?.tiers[k]).map((k) => {
                const q = quote!.tiers[k]!;
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
                    <span className="block tabular-nums text-body">{formatPrice(q.carrier_cost_qar * (doSplit ? 2 : 1), locale)}</span>
                    <span className="block text-[12px] text-mutedtext">
                      {q.date ? tD("arrivesBy", { date: formatDeliveryDate(q.date, locale) }) : "—"}
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
                    {tD("splitOption", { cost: formatPrice(chosen?.carrier_cost_qar ?? 0, locale) })}
                  </label>
                )}
              </div>
            )}
            <p className="text-[11px] text-faint">{tD("promiseNote")}</p>
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
            <Button type="submit" size="lg" disabled={submitting || blocked} className="rounded-full">
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
                  {i.leadTimeClass && (
                    <span className="block text-[11px] text-faint">{tD(`lt_${i.leadTimeClass}`)}</span>
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
          <div className="flex items-center justify-between text-sm">
            <span className="text-mutedtext">
              {tD("shippingLine", { tier: tD(`tier_${tier}`) })}
              {doSplit && " × 2"}
            </span>
            <span className="tabular-nums text-heading">{formatPrice(shippingQar, locale)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mutedtext">{tD("handlingLine")}</span>
            <span className="tabular-nums text-heading">{formatPrice(handlingQar, locale)}</span>
          </div>
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

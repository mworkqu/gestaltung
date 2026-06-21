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

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export default function CheckoutPage() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const { items, totalQar, clearCart, ready } = useCart();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the cart is empty (e.g. after a refresh post-checkout), bounce to /parts.
  useEffect(() => {
    if (ready && items.length === 0 && !submitting) {
      router.replace("/parts");
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

    setSubmitting(true);
    const supabase = createClient();

    const { data, error: rpcError } = await supabase.rpc("create_part_order", {
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail || null,
      p_delivery_area: deliveryArea,
      p_delivery_notes: deliveryNotes || null,
      p_items: items.map((i) => ({ part_id: i.partId, quantity: i.quantity })),
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
          total: totalQar,
          items: items.map((i) => ({
            sku: i.sku,
            name: i.name,
            nameAr: i.nameAr,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        })
      );
    } catch {
      // sessionStorage unavailable — the success page falls back gracefully.
    }

    clearCart();
    router.push({ pathname: "/parts/checkout/success", query: { order: orderId } });
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
            <Button type="submit" size="lg" disabled={submitting} className="rounded-full">
              {submitting && <Loader2 className="animate-spin" />}
              {t("placeOrder")}
            </Button>
            <Button asChild variant="ghost" className="rounded-full">
              <Link href="/parts/cart">{t("backToCart")}</Link>
            </Button>
          </div>
        </form>

        {/* Order summary */}
        <aside className="neu h-fit space-y-4 p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-bold text-heading">{t("summaryTitle")}</h2>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.sku} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-body">
                  {(locale === "ar" && i.nameAr ? i.nameAr : i.name)}
                  <span className="text-mutedtext"> × {i.quantity}</span>
                </span>
                <span className="shrink-0 tabular-nums text-heading">
                  {formatPrice(i.unitPrice * i.quantity, locale)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-borderstrong/40 pt-3 text-sm">
            <span className="font-semibold text-heading">{t("total")}</span>
            <span className="font-bold tabular-nums text-heading">
              {formatPrice(totalQar, locale)}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-faint">{t("priceNote")}</p>
        </aside>
      </div>
    </div>
  );
}

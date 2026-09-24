"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/parts/format";
import { LAST_ORDER_KEY } from "@/lib/parts/constants";
import { formatDeliveryDate } from "@/lib/store/delivery";

const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

type OrderSnapshot = {
  id: string;
  customerName: string;
  total: number;
  shippingQar?: number;
  handlingQar?: number;
  tier?: string;
  split?: boolean;
  promisedDate?: string | null;
  earlyDate?: string | null;
  heldBy?: string | null;
  items: {
    sku: string;
    name: string;
    nameAr: string | null;
    quantity: number;
    unitPrice: number;
  }[];
};

export default function CheckoutSuccessPage() {
  const t = useTranslations("Checkout");
  const tD = useTranslations("Delivery");
  const locale = useLocale();
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("order"));
    try {
      const raw = window.sessionStorage.getItem(LAST_ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw) as OrderSnapshot);
    } catch {
      /* ignore */
    }
  }, []);

  const id = order?.id ?? orderId ?? "";
  const shortId = id ? id.slice(0, 8) : "";
  const itemCount = order
    ? order.items.reduce((s, i) => s + i.quantity, 0)
    : 0;

  const waText = t("whatsappMessage", {
    id: shortId,
    name: order?.customerName ?? "",
    count: itemCount,
    total: order ? order.total.toFixed(2) : "0.00",
  });
  const waHref = WHATSAPP_DIGITS
    ? `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(waText)}`
    : `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <div className="container py-12">
      <div className="neu mx-auto max-w-lg space-y-6 p-8 text-center sm:p-10">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" strokeWidth={1.5} />
        </span>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-heading">
            {t("successTitle")}
          </h1>
          {shortId && (
            <p className="font-mono text-xs text-mutedtext">
              {t("orderRef", { id: shortId })}
            </p>
          )}
          <p className="text-sm leading-relaxed text-body">{t("successNote")}</p>
        </div>

        {order && order.items.length > 0 && (
          <div className="space-y-2 text-start">
            <ul className="space-y-2">
              {order.items.map((i) => (
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
            {order.tier && (
              <>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-mutedtext">{tD("shippingLine", { tier: tD(`tier_${order.tier}`) })}</span>
                  <span className="tabular-nums text-heading">{formatPrice(order.shippingQar ?? 0, locale)}</span>
                </div>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-mutedtext">{tD("handlingLine")}</span>
                  <span className="tabular-nums text-heading">{formatPrice(order.handlingQar ?? 0, locale)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between border-t border-borderstrong/40 pt-3 text-sm">
              <span className="font-semibold text-heading">{t("total")}</span>
              <span className="font-bold tabular-nums text-heading">
                {formatPrice(order.total, locale)}
              </span>
            </div>
          </div>
        )}

        {order?.promisedDate && (
          <div className="rounded-xl bg-panel p-4 text-start text-sm shadow-neu-inset">
            {order.split && order.earlyDate ? (
              <p className="font-semibold text-heading">
                {tD("splitSummary", {
                  early: formatDeliveryDate(order.earlyDate, locale),
                  late: formatDeliveryDate(order.promisedDate, locale),
                })}
              </p>
            ) : (
              <p className="font-semibold text-heading">
                {tD("arrivesBy", { date: formatDeliveryDate(order.promisedDate, locale) })}
              </p>
            )}
            <p className="mt-1 text-[12px] text-mutedtext">{tD("promiseKept")}</p>
          </div>
        )}

        <Button asChild size="lg" className="w-full rounded-full">
          <a href={waHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" />
            {t("whatsappCta")}
          </a>
        </Button>

        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/store">{t("backToStore")}</Link>
        </Button>
      </div>
    </div>
  );
}

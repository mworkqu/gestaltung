import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/parts/format";
import { COMPANY_WHATSAPP, isPaymentMethod } from "@/lib/company";
import { buildTimeline, needsPayment, orderShort, type HistoryRow } from "@/lib/orders/status";
import { isUuid } from "@/lib/notifications/links";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { PaymentInstructions } from "@/components/payment/payment-instructions";
import { OrderStatusPill } from "@/components/orders/order-status-pill";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Orders" });
  return pageMetadata({
    locale,
    path: `/orders/${id}`,
    title: `${t("orderRef", { id: orderShort(id) })} | Gestaltung360`,
    noindex: true,
  });
}

// Private and per-request (the order's owner: an account or the guest session
// that placed it).
export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  profile_id: string | null;
  created_at: string;
  status: string;
  total_qar: number;
  payment_method?: string | null;
  shipping_qar?: number | null;
  credit_discount_qar?: number | null;
};

type ItemRow = { id: string; part_name: string; quantity: number; unit_price_qar: number; line_total_qar: number };

export default async function OrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/sign-in`);
  if (!isUuid(id)) notFound();

  const { data: orderData } = await supabase
    .from("part_orders")
    .select("*")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  const order = orderData as OrderRow | null;
  if (!order) notFound();

  const [{ data: itemData }, { data: historyData, error: historyError }] = await Promise.all([
    supabase.from("part_order_items").select("id, part_name, quantity, unit_price_qar, line_total_qar").eq("order_id", id),
    supabase.from("order_status_history").select("status, note, changed_at").eq("order_id", id).order("changed_at"),
  ]);
  const items = (itemData ?? []) as ItemRow[];
  // Before 0053 there is no history table: the timeline falls back to created_at.
  const history = (historyError ? [] : (historyData ?? [])) as HistoryRow[];
  const steps = buildTimeline(order, history);

  const t = await getTranslations("Orders");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const ref = orderShort(order.id);
  const placed = new Intl.DateTimeFormat(isRtl ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Qatar",
  }).format(new Date(order.created_at));
  const method = order.payment_method;
  const payMethod = isPaymentMethod(method) && needsPayment(order.status, method) ? method : null;
  const waHref = `${COMPANY_WHATSAPP.url}?text=${encodeURIComponent(t("whatsappText", { id: ref }))}`;
  const hasShipping = order.shipping_qar !== undefined && order.shipping_qar !== null;
  const shipping = Number(order.shipping_qar ?? 0);
  const credit = Number(order.credit_discount_qar ?? 0);

  return (
    <MessagesScope scope="orders">
      <div className="container max-w-3xl space-y-6 py-8">
        <Link
          href="/orders"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
          {t("back")}
        </Link>

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">{t("orderRef", { id: ref })}</h1>
            <p className="text-sm text-mutedtext">{t("placedOn", { date: placed })}</p>
          </div>
          <OrderStatusPill status={order.status} className="text-sm" />
        </header>

        <section className="neu p-6" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className={mono("mb-4 text-[10px] text-mutedtext")}>
            {t("timelineTitle")}
          </h2>
          <OrderTimeline steps={steps} locale={locale} />
        </section>

        {payMethod && (
          <section className="space-y-3" aria-labelledby="pay-title">
            <h2 id="pay-title" className={mono("text-[10px] text-mutedtext")}>
              {t("payTitle")}
            </h2>
            <PaymentInstructions method={payMethod} amount={formatPrice(Number(order.total_qar), locale)} orderRef={ref} />
          </section>
        )}

        <section className="neu overflow-x-auto p-2" aria-labelledby="items-title">
          <h2 id="items-title" className={mono("px-4 pt-3 text-[10px] text-mutedtext")}>
            {t("itemsTitle")}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-borderstrong/60 text-[11px] text-mutedtext">
                  <th className="px-4 py-2 text-start font-medium">{t("colItem")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("colQty")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("colPrice")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-borderstrong/40 last:border-0">
                    <td className="px-4 py-3 text-heading">{it.part_name}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-body">{it.quantity}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-end tabular-nums text-heading">
                      {formatPrice(Number(it.line_total_qar), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {hasShipping && (
                  <tr className="border-t border-borderstrong/60">
                    <td colSpan={2} className="px-4 py-2 text-end text-mutedtext">
                      {t("shipping")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-end tabular-nums text-body">
                      {shipping > 0 ? formatPrice(shipping, locale) : t("freeDelivery")}
                    </td>
                  </tr>
                )}
                {credit > 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-2 text-end text-mutedtext">
                      {t("creditDiscount")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-end tabular-nums text-buy">
                      {"−"}
                      {formatPrice(credit, locale)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-borderstrong/60">
                  <td colSpan={2} className="px-4 py-3 text-end font-semibold text-heading">
                    {t("total")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-end text-base font-bold tabular-nums text-heading">
                    {formatPrice(Number(order.total_qar), locale)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
          <a href={waHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" aria-hidden />
            {t("whatsappCta")}
          </a>
        </Button>
      </div>
    </MessagesScope>
  );
}

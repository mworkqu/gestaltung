import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatPrice,
  partName,
  partDescription,
  partImageUrl,
} from "@/lib/parts/format";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { RequestItemButton } from "@/components/parts/request-item-button";
import { DemandBeacon } from "@/components/parts/demand-beacon";
import { formatDeliveryDate, SHIPPING_TIERS, type DeliveryQuote } from "@/lib/store/delivery";
import { PartDetailCart } from "@/components/parts/part-detail-cart";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PartDetailPage({
  params,
}: {
  params: Promise<{ locale: string; sku: string }>;
}) {
  const { locale, sku } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Parts");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase
    .from("parts")
    .select("*")
    .eq("sku", sku)
    .eq("is_published", true)
    .maybeSingle();

  const part = data as Part | null;
  if (!part) notFound();

  // Honest delivery estimate: the same quote checkout will record (0029).
  const tDelivery = await getTranslations("Delivery");
  const { data: quoteData } = await supabase.rpc("order_delivery_quote", {
    p_items: [{ part_id: part.id, quantity: part.min_order_qty }],
  });
  const quote = (quoteData ?? null) as DeliveryQuote | null;
  const onRequest = !part.lead_time_class;

  const name = partName(part, locale);
  const description = partDescription(part, locale);
  const imageUrl = partImageUrl(part);

  const spec = (label: string, value: string | null) =>
    value ? (
      <div className="flex justify-between gap-4 border-b border-borderstrong/40 py-2 last:border-0">
        <dt className={mono("text-[10px] text-mutedtext")}>{label}</dt>
        <dd className="text-sm text-body">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="container space-y-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-xs text-mutedtext">
        <Link href="/store" className="hover:text-heading">
          {t("breadcrumbStore")}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        <Link href={{ pathname: "/store", query: { category: part.category } }} className="hover:text-heading">
          {part.category}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        <span className="text-heading">{name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Image */}
        <div className="neu aspect-square overflow-hidden">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <GearPlaceholder className="h-full w-full" />
          )}
        </div>

        {/* Details */}
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-panel px-2 py-0.5 font-mono text-[11px] text-mutedtext">
                {part.sku}
              </span>
              <LeadTimeBadge leadClass={part.lead_time_class} />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
              {name}
            </h1>
            <p className="text-2xl font-bold text-heading">
              {formatPrice(part.unit_price, locale)}
              <span className="ms-1 text-sm font-normal text-mutedtext">
                {t("perUnit")}
              </span>
            </p>
            <p className="text-sm text-mutedtext">
              {part.min_order_qty > 1
                ? t("minOrder", { qty: part.min_order_qty })
                : t("noMinimum")}
            </p>
          </div>

          {onRequest ? (
            <p className="text-sm text-body">{tDelivery("onRequestBody")}</p>
          ) : (
            quote?.tiers?.standard?.date && (
              <div className="rounded-xl bg-panel p-3 text-sm shadow-neu-inset">
                <p className="font-semibold text-heading">
                  {tDelivery("arrivesBy", { date: formatDeliveryDate(quote.tiers.standard.date, locale) })}
                  <span className="font-normal text-mutedtext"> · {tDelivery("tier_standard")}</span>
                </p>
                <p className="mt-1 text-xs text-mutedtext">
                  {SHIPPING_TIERS.filter((k) => k !== "standard" && quote.tiers[k]?.date)
                    .map((k) => `${tDelivery(`tier_${k}`)}: ${formatDeliveryDate(quote.tiers[k]!.date, locale)}`)
                    .join(" · ")}
                </p>
              </div>
            )
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!onRequest && <PartDetailCart part={part} />}
            <RequestItemButton partId={part.id} partName={name} variant={onRequest ? "default" : "outline"} />
          </div>
          <DemandBeacon kind="view" partId={part.id} />

          {description && (
            <div className="space-y-2">
              <h2 className={mono("text-[10px] text-mutedtext")}>
                {t("descriptionLabel")}
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-body">
                {description}
              </p>
            </div>
          )}

          <dl className="neu p-4">
            {spec(t("specCategory"), part.category)}
            {spec(t("specMaterial"), part.material)}
            {spec(t("specStandard"), part.standard)}
            {spec(t("specMinOrder"), String(part.min_order_qty))}
          </dl>
        </div>
      </div>
    </div>
  );
}

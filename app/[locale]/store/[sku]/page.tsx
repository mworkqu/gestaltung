import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight, ExternalLink, FileText } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatPrice,
  partName,
  partImageUrl,
} from "@/lib/parts/format";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { RequestItemButton } from "@/components/parts/request-item-button";
import { DemandBeacon } from "@/components/parts/demand-beacon";
import { arrivesByDate, formatDeliveryDate, SHIPPING_TIERS, type DeliveryQuote } from "@/lib/store/delivery";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import { canRequestItem, showMinOrder } from "@/lib/store/product-display";
import { minDeliveryFrom, qarAmount } from "@/lib/store/shipping";
import { PartDetailCart } from "@/components/parts/part-detail-cart";
import { AddToProjectButton } from "@/components/parts/add-to-project-button";
import { materialLabel } from "@/lib/parts/part-key";
import { categoryLabel } from "@/lib/store/category-label";
import { cn } from "@/lib/utils";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { productDetailsForLocale } from "@/lib/store/product-details";
import { clipText, ogProductImage, pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Each product's own title and description (audit #56), plus the share card:
// the product photo as og:image, price first in og:description. The Arabic
// description comes only from description_ar (never raw English supplier text);
// without it the localized fallback line is used.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; sku: string }>;
}): Promise<Metadata> {
  const { locale, sku } = await params;
  const supabase = await createClient();
  // select("*"): specs_ar (0047) may not exist yet, so no named columns here.
  const { data } = await supabase.from("parts").select("*").eq("sku", sku).eq("is_published", true).maybeSingle();
  if (!data) return {};
  const part = data as Part & { specs?: unknown; specs_ar?: unknown };
  const t = await getTranslations({ locale, namespace: "Meta" });
  const name = partName(part, locale);
  const plain = productDetailsForLocale(part, locale).plainDescription;
  const description = plain ? clipText(plain, 155) : t("productDescription", { name });
  const price = formatPrice(Number(part.unit_price), locale);
  return pageMetadata({
    locale,
    path: `/store/${encodeURIComponent(sku)}`,
    title: t("productTitle", { name }),
    description,
    ogDescription: clipText(`${price} · ${description}`, 200),
    image: ogProductImage(partImageUrl(part)),
    imageAlt: name,
    other: {
      "product:price:amount": Number(part.unit_price).toFixed(2),
      "product:price:currency": "QAR",
    },
  });
}

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
  if (!part) {
    // Audit #7: an old SKU merged into another product (0030) → that product.
    // Before 0030 the RPC does not exist; fall through to 404 as before.
    const { data: survivorSku } = await supabase.rpc("part_merged_redirect_sku", { p_sku: sku });
    if (typeof survivorSku === "string" && survivorSku && survivorSku !== sku) {
      permanentRedirect(`/${locale === "ar" ? "ar" : "en"}/store/${encodeURIComponent(survivorSku)}`);
    }
    notFound();
  }

  // Honest delivery estimate: the same quote checkout will record (0029).
  // A product with no supplier offer is still sold at its listed price; its
  // date is confirmed after the order (0032).
  const tDelivery = await getTranslations("Delivery");
  const { data: quoteData } = await supabase.rpc("order_delivery_quote", {
    p_items: [{ part_id: part.id, quantity: part.min_order_qty }],
  });
  const quote = (quoteData ?? null) as DeliveryQuote | null;
  const onRequest = !part.lead_time_class;
  // Standard-tier date: the quote's, else the same sum computed in TS (the
  // card's formula) if the quote couldn't load.
  const standardDate =
    quote?.tiers?.standard?.date ??
    (onRequest ? null : arrivesByDate(part.lead_time_class, await loadShippingSettings()));
  // Cheapest tier at its normal price (0044); shown beside the date.
  const deliveryFrom = minDeliveryFrom(quote?.tiers);
  const deliveryFromLine =
    deliveryFrom !== null ? tDelivery("deliveryFrom", { min: qarAmount(deliveryFrom) }) : null;

  const name = partName(part, locale);
  // Description + spec table for this locale (lib/store/product-details.ts):
  // /en = supplier text and table (title lines and dead "Links" dropped);
  // /ar = only description_ar / specs_ar (0047) — never raw English. The row
  // comes from select('*'), so before 0047 specs_ar is simply absent.
  const {
    description,
    specs: specRows,
    links,
    untranslated,
  } = productDetailsForLocale(part as Part & { specs?: unknown; specs_ar?: unknown }, locale);
  // /ar without its Arabic yet: a short Arabic note + the English page.
  const notTranslated = (
    <p className="text-sm text-mutedtext">
      {t("detailsNotTranslated")}{" "}
      <Link href={`/store/${encodeURIComponent(part.sku)}`} locale="en" className="font-semibold text-cobalt hover:underline">
        {t("viewInEnglish")}
      </Link>
    </p>
  );
  const datasheet = (part as { datasheet_url?: string | null }).datasheet_url ?? null;
  const imageUrl = partImageUrl(part);

  const spec = (label: string, value: string | null) =>
    value ? (
      <div className="flex justify-between gap-4 border-b border-borderstrong/40 py-2 last:border-0">
        <dt className={mono("shrink-0 text-[10px] text-mutedtext")}>{label}</dt>
        <dd className="min-w-0 break-words text-end text-sm text-body">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="container space-y-6 py-6 sm:space-y-8 sm:py-8">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-x-1.5 text-xs text-mutedtext">
        <Link href="/store" className="inline-flex items-center hover:text-heading max-md:min-h-11">
          {t("breadcrumbStore")}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        <Link href={{ pathname: "/store", query: { category: part.category } }} className="inline-flex items-center hover:text-heading max-md:min-h-11">
          {categoryLabel(part.category, locale)}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        <span className="min-w-0 break-words text-heading">{name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Image: fixed square + panel background so a late-loading photo never shifts the layout. */}
        <div className="neu aspect-square min-w-0 overflow-hidden bg-panel">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={name}
              className="h-full w-full object-contain"
            />
          ) : (
            <GearPlaceholder className="h-full w-full" />
          )}
        </div>

        {/* Details */}
        <div className="min-w-0 space-y-6">
          <div className="space-y-3">
            {onRequest && (
              <div className="flex flex-wrap items-center gap-3">
                <LeadTimeBadge leadClass={null} />
              </div>
            )}
            <h1 className="break-words text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
              <IsolatedTitle text={name} locale={locale} />
            </h1>
            <p className="text-2xl font-bold text-heading">
              {formatPrice(part.unit_price, locale)}
              <span className="ms-1 text-sm font-normal text-mutedtext">
                {t("perUnit")}
              </span>
            </p>
            {showMinOrder(part.min_order_qty) && (
              <p className="text-sm text-mutedtext">{t("minOrder", { qty: part.min_order_qty })}</p>
            )}
          </div>

          {onRequest ? (
            <div className="space-y-1">
              <p className="text-sm text-body">{tDelivery("onRequestOrderable")}</p>
              {deliveryFromLine && <p className="text-sm font-medium text-heading">{deliveryFromLine}</p>}
            </div>
          ) : (
            standardDate && (
              <div className="rounded-xl bg-panel p-3 text-sm shadow-neu-inset">
                <p className="font-semibold text-heading">
                  {tDelivery("arrivesBy", { date: formatDeliveryDate(standardDate, locale) })}
                  <span className="font-normal text-mutedtext"> · {tDelivery("tier_standard")}</span>
                  {deliveryFromLine && <span className="font-normal text-body"> · {deliveryFromLine}</span>}
                </p>
                {quote && (
                  <p className="mt-1 text-xs text-mutedtext">
                    {SHIPPING_TIERS.filter((k) => k !== "standard" && quote.tiers[k]?.date)
                      .map((k) => `${tDelivery(`tier_${k}`)}: ${formatDeliveryDate(quote.tiers[k]!.date, locale)}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )
          )}

          <div className="flex flex-wrap items-center gap-3">
            <PartDetailCart part={part} />
            <AddToProjectButton partId={part.id} partName={name} />
            {canRequestItem(part.lead_time_class) && (
              <RequestItemButton partId={part.id} partName={name} variant="outline" />
            )}
          </div>
          <DemandBeacon kind="view" partId={part.id} />

          {(description || untranslated.description) && (
            <div className="space-y-2">
              <h2 className={mono("text-[10px] text-mutedtext")}>
                {t("descriptionLabel")}
              </h2>
              {description ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-body">
                  {description}
                </p>
              ) : (
                notTranslated
              )}
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-2">
              <h2 className={mono("text-[10px] text-mutedtext")}>{t("linksLabel")}</h2>
              <ul className="flex flex-wrap gap-2">
                {links.map((l) => (
                  <li key={l.url}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-semibold text-cobalt shadow-neu-sm hover:underline max-md:min-h-11"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(specRows.length > 0 || datasheet || untranslated.specs) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className={mono("text-[10px] text-mutedtext")}>{t("specsLabel")}</h2>
                {datasheet && (
                  <a
                    href={datasheet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-semibold text-cobalt shadow-neu-sm hover:underline max-md:min-h-11"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {t("datasheet")}
                  </a>
                )}
              </div>
              {specRows.length === 0 && untranslated.specs && !untranslated.description && notTranslated}
              {specRows.length > 0 && (
                <div className="neu overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-borderstrong/40">
                      {specRows.map((r, i) => (
                        <tr key={`${i}-${r.name}`}>
                          <th scope="row" className="w-2/5 break-words px-4 py-2 text-start text-[12.5px] font-medium text-mutedtext">
                            {r.name}
                          </th>
                          <td className="break-words px-4 py-2 text-[12.5px] text-heading" dir="auto">
                            {r.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <dl className="neu p-4">
            {spec(t("specCategory"), categoryLabel(part.category, locale))}
            {spec(t("specMaterial"), materialLabel(part.material) || null)}
            {spec(t("specStandard"), part.standard)}
            {spec(t("specMinOrder"), showMinOrder(part.min_order_qty) ? String(part.min_order_qty) : null)}
          </dl>
        </div>
      </div>
    </div>
  );
}

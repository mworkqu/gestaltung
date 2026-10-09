import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight, ExternalLink, FileText } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
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
import { PartCard } from "@/components/parts/part-card";
import { AddToProjectButton } from "@/components/parts/add-to-project-button";
import { materialLabel } from "@/lib/parts/part-key";
import { categoryLabel } from "@/lib/store/category-label";
import { storeCategoryOf } from "@/lib/store/store-categories";
import { cn } from "@/lib/utils";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { productDetailsForLocale } from "@/lib/store/product-details";
import { clipText, ogProductImage, pageMetadata } from "@/lib/seo";
import { ReviewTiles } from "@/components/reviews/review-tiles";
import {
  getApprovedReviewsForSku,
  getFrequentlyBoughtTogether,
  getHolidays,
  getMergedRedirectSku,
  getPartSource,
  getProductDeliveryQuote,
  getPublishedPart,
} from "@/lib/store/public-catalog";
import { backupLine, leadInSentence, sourceLine } from "@/lib/store/part-source";
import { GALLERY_SIZES, IMAGE_WIDTHS, sizedImage, sizedSrcSet } from "@/lib/store/image-url";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

// ISR (Phase G): each product page is rendered on its first visit per locale,
// then served from the CDN and re-rendered at most every 5 minutes (prices,
// lead time and the "Arrives by" dates are at most that stale) or at once
// when an admin edit calls revalidateStorefront(). Everything here is
// cookie-free (cached anon reads in lib/store/public-catalog.ts); per-visitor
// bits (cart, add to project) are client components.
export const revalidate = 300;

// No product is built at deploy time; each one is cached on first request.
export function generateStaticParams() {
  return [];
}

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
  const data = await getPublishedPart(sku);
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

  const part = await getPublishedPart(sku);
  if (!part) {
    // Audit #7: an old SKU merged into another product (0030) → that product.
    // Before 0030 the RPC does not exist; fall through to 404 as before.
    const survivorSku = await getMergedRedirectSku(sku);
    if (survivorSku) {
      permanentRedirect(`/${locale === "ar" ? "ar" : "en"}/store/${encodeURIComponent(survivorSku)}`);
    }
    notFound();
  }

  // Honest delivery estimate: the same quote checkout will record (0029).
  // A product with no supplier offer is still sold at its listed price; its
  // date is confirmed after the order (0032).
  const tDelivery = await getTranslations("Delivery");
  const quote: DeliveryQuote | null = await getProductDeliveryQuote(part.id, part.min_order_qty);
  const onRequest = !part.lead_time_class;
  // Standard-tier date: the quote's, else the same sum computed in TS (the
  // card's formula) if the quote couldn't load.
  const standardDate =
    quote?.tiers?.standard?.date ??
    (onRequest ? null : arrivesByDate(part.lead_time_class, await loadShippingSettings()));
  // Dates skip the Qatar weekend + holidays once 0054 has run (the quote says
  // so; the TS fallback has the setting) — then the note is shown once.
  const workingDays = Boolean(quote?.working_days) || (!quote && Boolean(await getHolidays()));
  // Source line (P2-07): supplier name + lead class only — never a cost.
  const source = await getPartSource(part.id);
  const srcLine = sourceLine(source, part.lead_time_class);
  const sourceText =
    !srcLine || srcLine.kind === "on_request" // the LeadTimeBadge above already says "Available on request"
      ? null
      : srcLine.kind === "stocked_local"
        ? t("sourceStockedLocal", { supplier: srcLine.supplier })
        : srcLine.kind === "sourced"
          ? t("sourceFrom", { supplier: srcLine.supplier })
          : t("sourceFromLead", {
              supplier: srcLine.supplier,
              lead: leadInSentence(tDelivery(`lt_${srcLine.leadTimeClass}`), locale),
            });
  const backup = backupLine(source);
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
  // Storefront category (0048 store_category, else the source category).
  const storeCategory = storeCategoryOf(part) ?? part.category;
  // Add to cart / Add to project may mint a guest session (P2-08). Cached
  // public read, tag "store-settings": the page stays ISR.
  const turnstileEnabled = await turnstileEnabledForPages();
  // P3-06: co-purchased products (0057), else same-category ones — the
  // heading says which. Cached anon read (tag "parts"): the page stays ISR.
  const upsell = await getFrequentlyBoughtTogether(part.sku, storeCategory ?? null);
  const tUpsell = await getTranslations("Upsell");
  // P4-03: approved reviews from orders that contained this SKU (0058). Cached anon
  // read (tag "parts"); empty until the owner approves one, so the page stays ISR.
  const reviews = await getApprovedReviewsForSku(part.sku);
  const tReviews = await getTranslations("Reviews");

  const spec = (label: string, value: string | null) =>
    value ? (
      <div className="flex justify-between gap-4 border-b border-borderstrong/40 py-2 last:border-0">
        <dt className={mono("shrink-0 text-[10px] text-mutedtext")}>{label}</dt>
        <dd className="min-w-0 break-words text-end text-sm text-body">{value}</dd>
      </div>
    ) : null;

  return (
    <MessagesScope scope="product">
    <div className="container space-y-6 py-6 sm:space-y-8 sm:py-8">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-x-1.5 text-xs text-mutedtext">
        <Link href="/store" className="inline-flex items-center hover:text-heading max-md:min-h-11">
          {t("breadcrumbStore")}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
        <Link href={{ pathname: "/store", query: { category: storeCategory } }} className="inline-flex items-center hover:text-heading max-md:min-h-11">
          {categoryLabel(storeCategory, locale)}
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
              src={sizedImage(imageUrl, IMAGE_WIDTHS.gallery)!}
              srcSet={sizedSrcSet(imageUrl, [600, IMAGE_WIDTHS.gallery])}
              sizes={GALLERY_SIZES}
              width={IMAGE_WIDTHS.gallery}
              height={IMAGE_WIDTHS.gallery}
              alt={name}
              fetchPriority="high"
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
                {workingDays && <p className="mt-1 text-xs text-mutedtext">{tDelivery("workingDaysNote")}</p>}
              </div>
            )
          )}

          {(sourceText || backup) && (
            <div className="space-y-0.5 text-sm">
              {sourceText && <p className="text-body">{sourceText}</p>}
              {backup && (
                <p className="text-mutedtext">
                  <Link
                    href={`/store/${encodeURIComponent(backup.sku)}`}
                    className="inline-flex items-center hover:text-heading hover:underline max-md:min-h-11"
                  >
                    {t("sourceBackup", { supplier: backup.supplier })}
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <PartDetailCart part={{ id: part.id, min_order_qty: part.min_order_qty }} />
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
            {spec(t("specCategory"), categoryLabel(storeCategory, locale))}
            {spec(t("specMaterial"), materialLabel(part.material) || null)}
            {spec(t("specStandard"), part.standard)}
            {spec(t("specMinOrder"), showMinOrder(part.min_order_qty) ? String(part.min_order_qty) : null)}
          </dl>
        </div>
      </div>
      {reviews.length > 0 && (
        <section aria-labelledby="reviews-heading" className="neu space-y-4 p-5 sm:p-6">
          <h2 id="reviews-heading" className="title-section">
            {tReviews("heading")}
          </h2>
          <ReviewTiles reviews={reviews} locale={locale} />
        </section>
      )}
      {upsell.parts.length > 0 && (
        <section aria-labelledby="upsell-heading" className="space-y-4 pt-2">
          <h2 id="upsell-heading" className="title-section">
            {upsell.source === "together" ? tUpsell("boughtTogether") : tUpsell("mayAlsoNeed")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {upsell.parts.map((p) => (
              <PartCard key={p.id} part={p} locale={locale} upsell="product" />
            ))}
          </div>
        </section>
      )}
      <TurnstileChallenge enabled={turnstileEnabled} />
    </div>
    </MessagesScope>
  );
}

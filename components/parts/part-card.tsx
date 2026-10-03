import { getTranslations } from "next-intl/server";

import type { StoreCardPart } from "@/lib/store/catalog";
import { Link } from "@/i18n/navigation";
import { formatPrice, partName, partImageUrl } from "@/lib/parts/format";
import { arrivesByDate, type ShippingSettings } from "@/lib/store/delivery";
import { canRequestItem, showMinOrder } from "@/lib/store/product-display";
import { loadShippingSettings } from "@/lib/store/shipping-settings";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { ArrivalBadge } from "@/components/parts/arrival-badge";
import { AddToCartButton } from "@/components/parts/add-to-cart-button";
import { RequestItemButton } from "@/components/parts/request-item-button";
import { IsolatedTitle } from "@/components/ltr-isolate";
import { truncateAtWord } from "@/lib/text/title";

// Catalog grid card. Server component; the cart action lives in the client
// AddToCartButton child. Image URLs are admin-pasted from arbitrary hosts, so a
// plain <img> is used rather than next/image (which needs configured domains).
// Reads only StoreCardPart (lib/store/catalog.ts) — the /store list sends no more.
//
// The SKU is not shown (owner decision D4); it stays in the product URL.
// "Arrives by" is computed here from the shipping settings (no call per card):
// the /store list reads the settings once and passes them in; other callers
// (the homepage) omit them and get the request-cached read.
export async function PartCard({
  part,
  locale,
  shipping,
}: {
  part: StoreCardPart;
  locale: string;
  shipping?: ShippingSettings | null;
}) {
  const t = await getTranslations("Parts");
  const name = partName(part, locale);
  const imageUrl = partImageUrl(part);
  const settings = shipping === undefined ? await loadShippingSettings() : shipping;
  const arrives = arrivesByDate(part.lead_time_class, settings);
  // Arabic titles can be long; the card shows the first 80 characters (cut at a
  // word) and keeps the full title in title/aria-label.
  const shownName = locale === "ar" ? truncateAtWord(name) : name;

  // Phones show two cards per row (~165 px each), so the card gets tighter
  // padding and type below sm, and its buttons may wrap to two lines instead
  // of overflowing ("Added — View cart", "Request this item").
  const cardBtn = "w-full max-sm:h-auto max-sm:whitespace-normal max-sm:px-2 max-sm:py-2 max-sm:leading-tight";

  return (
    <div className="neu flex min-w-0 flex-col overflow-hidden max-sm:rounded-2xl">
      <Link
        href={`/store/${part.sku}`}
        className="block aspect-square overflow-hidden bg-panel"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <GearPlaceholder className="h-full w-full" />
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5 sm:gap-3 sm:p-4">
        <Link
          href={`/store/${part.sku}`}
          className="line-clamp-2 break-words max-md:min-h-11 text-[13px] font-semibold leading-snug text-heading transition-colors hover:text-cobalt sm:text-sm"
          title={name}
          aria-label={name}
        >
          <IsolatedTitle text={shownName} locale={locale} />
        </Link>

        <div>
          <ArrivalBadge
            leadClass={part.lead_time_class}
            date={arrives}
            className="max-sm:whitespace-normal max-sm:rounded-lg max-sm:leading-tight"
          />
        </div>

        <div className="mt-auto space-y-2">
          <p className="text-sm font-bold text-heading sm:text-base">
            {formatPrice(part.unit_price, locale)}
          </p>
          {showMinOrder(part.min_order_qty) && (
            <p className="text-[11px] text-mutedtext">{t("minOrder", { qty: part.min_order_qty })}</p>
          )}
          <AddToCartButton part={part} className={cardBtn} />
          {canRequestItem(part.lead_time_class) && (
            <RequestItemButton partId={part.id} partName={name} size="sm" className={cardBtn} />
          )}
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div className="neu flex flex-col overflow-hidden">
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
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <GearPlaceholder className="h-full w-full" />
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <Link
          href={`/store/${part.sku}`}
          className="line-clamp-2 text-sm font-semibold text-heading transition-colors hover:text-cobalt"
        >
          {name}
        </Link>

        <div>
          <ArrivalBadge leadClass={part.lead_time_class} date={arrives} />
        </div>

        <div className="mt-auto space-y-2">
          <p className="text-base font-bold text-heading">
            {formatPrice(part.unit_price, locale)}
          </p>
          {showMinOrder(part.min_order_qty) && (
            <p className="text-[11px] text-mutedtext">{t("minOrder", { qty: part.min_order_qty })}</p>
          )}
          <AddToCartButton part={part} className="w-full" />
          {canRequestItem(part.lead_time_class) && (
            <RequestItemButton partId={part.id} partName={name} size="sm" className="w-full" />
          )}
        </div>
      </div>
    </div>
  );
}

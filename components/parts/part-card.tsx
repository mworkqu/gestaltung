import { getTranslations } from "next-intl/server";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { formatPrice, partName, partImageUrl } from "@/lib/parts/format";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { StockBadge } from "@/components/parts/stock-badge";
import { AddToCartButton } from "@/components/parts/add-to-cart-button";

// Catalog grid card. Server component; the cart action lives in the client
// AddToCartButton child. Image URLs are admin-pasted from arbitrary hosts, so a
// plain <img> is used rather than next/image (which needs configured domains).
export async function PartCard({
  part,
  locale,
}: {
  part: Part;
  locale: string;
}) {
  const t = await getTranslations("Parts");
  const name = partName(part, locale);
  const imageUrl = partImageUrl(part);

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
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/store/${part.sku}`}
            className="line-clamp-2 text-sm font-semibold text-heading transition-colors hover:text-cobalt"
          >
            {name}
          </Link>
          <StockBadge status={part.stock_status} className="shrink-0" />
        </div>

        <span className="w-fit rounded-md bg-panel px-2 py-0.5 font-mono text-[10px] text-mutedtext">
          {part.sku}
        </span>

        <div className="mt-auto space-y-2">
          <p className="text-base font-bold text-heading">
            {formatPrice(part.unit_price, locale)}
          </p>
          <p className="text-[11px] text-mutedtext">
            {part.min_order_qty > 1
              ? t("minOrder", { qty: part.min_order_qty })
              : t("noMinimum")}
          </p>
          <AddToCartButton part={part} className="w-full" />
        </div>
      </div>
    </div>
  );
}

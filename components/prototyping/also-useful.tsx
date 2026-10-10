"use client";

// "Also useful" under the BOM's kit box (P3-06 / WF-34): three published
// products from the same store categories as the BOM's resolved lines, none
// already on the BOM, in stock first. The list comes with /api/bom/match
// (lib/store/bought-together.ts pickAlsoUseful over the cached catalogue), so
// it costs no AI call and writes nothing. Card fields only — never a cost.
// Add to cart is a plain cart add (not tied to the project's BOM lines) and
// fires upsell_added {where: "bom"}.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { SoftButton } from "@/components/prototyping/ui";
import { track } from "@/lib/analytics";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import type { StoreCardPart } from "@/lib/store/catalog";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import { MIN_ALSO_USEFUL } from "@/lib/store/also-useful-relevance";

export function AlsoUseful({ parts }: { parts: StoreCardPart[] }) {
  const t = useTranslations("Upsell");
  const locale = useLocale();
  const { addItem } = useCart();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  // Fewer than two relevant products is not worth a block (P5-04).
  if (parts.length < MIN_ALSO_USEFUL) return null;

  async function add(p: StoreCardPart) {
    setAdding(p.id);
    // A failed add is shown by the cart (useCart().error); only mark saved ones.
    if (await addItem({ id: p.id, min_order_qty: p.min_order_qty, sku: p.sku }, p.min_order_qty)) {
      setAdded((s) => new Set(s).add(p.id));
      track("upsell_added", { sku: p.sku, where: "bom" });
    }
    setAdding(null);
  }

  return (
    <section aria-labelledby="also-useful-heading" className="space-y-2">
      <div>
        <h3 id="also-useful-heading" className="text-[13px] font-bold text-heading">
          {t("alsoUseful")}
        </h3>
        <p className="text-[11.5px] text-mutedtext">{t("alsoUsefulIntro")}</p>
      </div>
      <ul className="grid grid-cols-1 gap-x-4 divide-y divide-borderstrong/40 sm:grid-cols-3 sm:divide-y-0">
        {parts.map((p) => {
          const name = partName(p, locale);
          const img = partImageUrl(p);
          const done = added.has(p.id);
          return (
            <li key={p.id} className="flex min-w-0 items-center gap-3 py-2 sm:flex-col sm:items-stretch sm:py-0">
              <Link
                href={`/store/${encodeURIComponent(p.sku)}`}
                className="flex min-w-0 flex-1 items-center gap-3 hover:text-cobalt sm:flex-none"
              >
                <span className="block h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-panel">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sizedImage(img, IMAGE_WIDTHS.thumb)!}
                      width={48}
                      height={48}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <GearPlaceholder className="h-full w-full" />
                  )}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="line-clamp-2 break-words text-[12.5px] font-semibold leading-snug text-heading" dir="auto">
                    {name}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] font-bold tabular-nums text-heading">
                      {formatPrice(p.unit_price, locale)}
                    </span>
                    <LeadTimeBadge leadClass={p.lead_time_class} />
                  </span>
                </span>
              </Link>
              {done ? (
                <Link
                  href="/store/cart"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-buy max-md:min-h-11 sm:self-start"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("added")}
                </Link>
              ) : (
                <SoftButton
                  onClick={() => void add(p)}
                  disabled={adding !== null}
                  aria-label={t("addNamed", { name })}
                  className="shrink-0 sm:self-start"
                >
                  {adding === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t("add")}
                </SoftButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

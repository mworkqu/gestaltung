"use client";

// The project page's parts list (P5-03): the SAME lines as the workspace bill
// of materials, each with one plain status — To buy · In your cart · Ordered ·
// Delivered. Reads the cart through useCart() (the header badge and the cart
// page read the same rows), the store matches from the page, and the status of
// the orders its bought lines name (own orders only, RLS). No ids, no scores.

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, partName } from "@/lib/parts/format";
import { fulfilledOrderIds } from "@/lib/prototyping/fulfilled";
import { activeLines, type LineMatch, type ProjectBom } from "@/lib/prototyping/bom";
import { cartLineIds, kitPlan } from "@/lib/prototyping/kit-plan";
import {
  cartProductsByLine,
  projectCartTotal,
  projectPartsList,
  statusCounts,
  type PartsListLine,
  type PartStatus,
} from "@/lib/projects/parts-list";
import type { CostState } from "@/lib/prototyping/bom-cost";
import { arabicCountForm } from "@/lib/text/count";

const STATUS_TAG: Record<PartStatus, "buy" | "inventory" | "neutral"> = {
  to_buy: "neutral",
  in_cart: "buy",
  ordered: "neutral",
  delivered: "inventory",
  have: "inventory",
};

export function ProjectPartsList({
  projectId,
  bom,
  matches,
  state,
}: {
  projectId: string;
  bom: ProjectBom | null;
  matches: Map<string, LineMatch>;
  state: CostState;
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const { items, kitDiscountPct, ready } = useCart();
  const lines = useMemo(() => activeLines(bom), [bom]);
  const orderIdsKey = fulfilledOrderIds(lines).join(",");
  const [orderStatuses, setOrderStatuses] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    const ids = orderIdsKey ? orderIdsKey.split(",") : [];
    if (!ids.length) return;
    let cancelled = false;
    void createClient()
      .from("part_orders")
      .select("id, status")
      .in("id", ids)
      .then(({ data, error }) => {
        if (cancelled) return;
        // A failed read keeps the bought lines on "Ordered" (never a guess at Delivered).
        setOrderStatuses(error ? null : new Map((data ?? []).map((o) => [o.id as string, o.status as string])));
      });
    return () => {
      cancelled = true;
    };
  }, [orderIdsKey]);

  if (!lines.length) return null;

  const inCart = cartLineIds(items, projectId);
  const list = projectPartsList(bom, matches, { inCart, orderStatuses, cartProducts: cartProductsByLine(items, projectId) });
  const counts = statusCounts(list);
  const cartTotal = projectCartTotal(items, projectId, kitDiscountPct);
  // What the workspace's kit button would add now: the same plan, the same total.
  const toBuy = state === "ready" ? kitPlan(lines, matches, { inCart, discountPct: kitDiscountPct }) : null;

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-heading">{t("partsListHeading")}</h2>
          <p className="mt-1 text-sm text-mutedtext">{t("partsListIntro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {toBuy && toBuy.add.length > 0 && (
          <span className="inline-flex min-h-11 items-center rounded-full bg-panel px-4 text-xs font-semibold text-heading shadow-neu-inset">
            {t("partsToBuyTotal", { total: formatPrice(toBuy.total, locale) })}
          </span>
        )}
        {ready && counts.in_cart > 0 && (
          <Link
            href="/store/cart"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-panel px-4 text-xs font-semibold text-buy shadow-neu-sm"
          >
            <ShoppingCart className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t("partsInCartTotal", { total: formatPrice(cartTotal, locale) })}
          </Link>
        )}
        </div>
      </div>

      <ul className="space-y-2">
        {list.map((l) => (
          <PartRow key={l.lineId} l={l} loading={state === "loading"} />
        ))}
      </ul>
      {state === "failed" && <p className="text-xs text-mutedtext">{t("partsListPricesFailed")}</p>}
    </section>
  );
}

function PartRow({ l, loading }: { l: PartsListLine; loading: boolean }) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const title = l.product ? partName(l.product, locale) : l.name;
  const detail =
    l.source === "we_pick"
      ? t("partWePick")
      : l.source === "we_source"
        ? t("partWeSource")
        : l.source === "made"
          ? t("partMadeToOrder")
          : l.product && l.packSize > 1
            ? t("partNeedPacks", {
                need: String(l.need),
                n: l.packs,
                count: String(l.packs),
                form: arabicCountForm(l.packs),
                size: String(l.packSize),
              })
            : t("partNeed", { need: String(l.need) });

  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-panel px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-heading">{title}</span>
        {loading && l.source === null ? (
          <Skeleton className="mt-1 h-2.5 w-32" />
        ) : (
          <span className="block text-[11.5px] text-mutedtext">{detail}</span>
        )}
      </span>
      <Tag variant={STATUS_TAG[l.status]}>{t(`partStatus_${l.status}`)}</Tag>
    </li>
  );
}

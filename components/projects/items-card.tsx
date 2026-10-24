"use client";

// The project's store items with their cart / order status (split out of
// project-workspace.tsx, R8).

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import { formatPrice, partName } from "@/lib/parts/format";
import {
  adjustCart,
  ownedCount,
  returnToInventory,
  splitOnAdd,
  splitOnRemove,
  takeFromInventory,
} from "@/lib/projects/allocation";
import type { ItemStatus } from "@/lib/projects/item-status";
import { UnifiedSearch, type SearchHit } from "@/components/search/unified-search";
import { Tag } from "@/components/ui/tag";
import { normaliseOrderStatus } from "@/lib/orders/status";
import type { ItemWithPart } from "./use-project-data";

export function ItemsCard({
  projectId,
  items,
  statuses,
  onChanged,
  hasPartsList,
}: {
  projectId: string;
  items: ItemWithPart[];
  statuses: Record<string, ItemStatus>;
  onChanged: () => Promise<void>;
  /** The project has a parts list (BOM) above: never call it empty. */
  hasPartsList: boolean;
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);
  // Which way the last add went, so we can say so plainly.
  const [lastMove, setLastMove] = useState<"inventory" | "cart" | null>(null);
  // Bumped after every allocation so the search re-reads the inventory it
  // just changed. items.length would miss a quantity-only move.
  const [version, setVersion] = useState(0);

  // A part is either on their shelf or on this project, never both. So take
  // whatever they already own off the inventory, and only buy the shortfall.
  async function add(hit: SearchHit) {
    if (!hit.part) return;
    setAddingKey(hit.key);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const part = hit.part;

      const { fromInventory, toCart } = splitOnAdd(1, hit.owned);

      const { data: existing } = await supabase
        .from("project_items")
        .select("id, quantity, qty_from_inventory")
        .eq("project_id", projectId)
        .eq("product_id", part.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("project_items")
          .update({
            quantity: existing.quantity + 1,
            qty_from_inventory: existing.qty_from_inventory + fromInventory,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("project_items").insert({
          project_id: projectId,
          product_id: part.id,
          quantity: 1,
          qty_from_inventory: fromInventory,
        });
      }

      await takeFromInventory(supabase, user.id, part.id, fromInventory);
      await adjustCart(supabase, user.id, part.id, projectId, toCart);

      setLastMove(fromInventory > 0 ? "inventory" : "cart");
      setVersion((v) => v + 1);
      await onChanged();
      setAddedKey(hit.key);
      setTimeout(() => setAddedKey(null), 1600);
    } finally {
      setAddingKey(null);
    }
  }

  async function setQuantity(item: ItemWithPart, quantity: number) {
    const user = await ensureSession();
    const supabase = createClient();
    const target = Math.max(0, quantity);
    const delta = target - item.quantity;
    if (delta === 0) return;

    if (delta > 0) {
      // Growing the line: shelf first, then the cart, same as adding.
      const owned = await ownedCount(supabase, user.id, item.product_id);
      const { fromInventory, toCart } = splitOnAdd(delta, owned);
      await supabase
        .from("project_items")
        .update({
          quantity: target,
          qty_from_inventory: item.qty_from_inventory + fromInventory,
        })
        .eq("id", item.id);
      await takeFromInventory(supabase, user.id, item.product_id, fromInventory);
      await adjustCart(supabase, user.id, item.product_id, projectId, toCart);
    } else {
      // Shrinking: release cart units first — those were never theirs — and
      // only then hand shelf units back.
      const drop = -delta;
      const { toCart, fromInventory } = splitOnRemove(
        drop,
        item.qty_from_inventory,
        item.quantity
      );
      await adjustCart(supabase, user.id, item.product_id, projectId, -toCart);
      await returnToInventory(supabase, user.id, item.product_id, fromInventory);

      if (target === 0) {
        await supabase.from("project_items").delete().eq("id", item.id);
      } else {
        await supabase
          .from("project_items")
          .update({
            quantity: target,
            qty_from_inventory: item.qty_from_inventory - fromInventory,
          })
          .eq("id", item.id);
      }
    }

    setVersion((v) => v + 1);
    await onChanged();
  }

  const total = items.reduce(
    (sum, i) => sum + (i.part ? i.part.unit_price * i.quantity : 0),
    0
  );

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div>
        <h2 className="text-sm font-semibold text-heading">{hasPartsList ? t("itemsHeadingMore") : t("itemsHeading")}</h2>
        <p className="mt-1 text-sm text-mutedtext">{hasPartsList ? t("itemsIntroMore") : t("itemsIntroStatus")}</p>
      </div>

      <UnifiedSearch
        onAdd={add}
        addingKey={addingKey}
        addedKey={addedKey}
        reloadKey={version}
      />

      {lastMove && (
        <p className="text-sm text-buy">
          {lastMove === "inventory" ? t("tookFromInventory") : t("addedToCart")}
        </p>
      )}

      {items.length === 0 ? (
        hasPartsList ? null : <p className="pt-1 text-sm text-mutedtext">{t("emptyProject")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">
                    {item.part ? partName(item.part, locale) : "—"}
                  </span>
                  {item.part && (
                    <span className="block truncate font-mono text-[11px] text-mutedtext">
                      {item.part.sku}
                    </span>
                  )}
                </span>

                {statuses[item.id] && (
                  <ItemStatusTags status={statuses[item.id]} />
                )}

                <input
                  type="number"
                  min={0}
                  value={item.quantity}
                  aria-label={t("quantity")}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) void setQuantity(item, n);
                  }}
                  className="w-16 rounded-lg border border-white/60 bg-surface px-2 py-1 text-center text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
                />

                {item.part && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-heading">
                    {formatPrice(item.part.unit_price * item.quantity, locale)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setQuantity(item, 0)}
                  aria-label={t("removeItem")}
                  className="shrink-0 rounded-md p-1.5 text-mutedtext transition-colors hover:text-destructive max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-borderstrong/40 pt-3">
            <span className="text-sm text-mutedtext">{t("itemsTotal")}</span>
            <span className="text-base font-bold tabular-nums text-heading">
              {formatPrice(total, locale)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

// Where each line actually is (audit #3): ordered / delivered / in cart / to
// buy, plus any units that came off the client's own shelf.
function ItemStatusTags({ status }: { status: ItemStatus }) {
  const t = useTranslations("Projects");
  const tOrders = useTranslations("PartsDashboard");

  const orderStatusLabel = (s: string | undefined) => {
    if (!s) return "";
    // Pre-0053 rows may say pending/processing: show them as confirmed/sourcing.
    const key = `order_status_${normaliseOrderStatus(s) ?? s}`;
    return tOrders.has(key) ? tOrders(key) : s;
  };

  return (
    <>
      {status.shelfQty > 0 && (
        <Tag variant="inventory">{t("yoursCount", { count: status.shelfQty })}</Tag>
      )}
      {status.kind === "ordered" && status.shortId && (
        <Tag variant="neutral">
          {t("itemOrdered", { id: status.shortId, status: orderStatusLabel(status.orderStatus) })}
        </Tag>
      )}
      {status.kind === "delivered" && (
        <Tag variant="inventory">{orderStatusLabel("delivered")}</Tag>
      )}
      {status.cartQty > 0 && (
        <Tag variant="buy">{t("itemInCart", { count: status.cartQty })}</Tag>
      )}
      {/* Whatever the kind: a part-delivered line can still be short. */}
      {status.missingQty > 0 && (
        <Tag variant="buy">{t("toBuyCount", { count: status.missingQty })}</Tag>
      )}
    </>
  );
}

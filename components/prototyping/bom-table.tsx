"use client";

// The bill of materials: what to buy, and where to buy it here.
//
// Every line is a function and a spec from the analysis. The product, price
// and stock beside it come live from the store (/api/bom/match) — nothing on
// this table is typed in by a model. Three states:
//   matched      one clear product; price, stock, add to cart
//   choose       several candidates; the client's pick is saved on the line
//   not stocked  no product; a "request a quote" action, never a made-up item
// A line the client already owns is marked and left out of the total.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, MessageSquareQuote, ShoppingCart, Star } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { StockBadge } from "@/components/parts/stock-badge";
import { Tag } from "@/components/ui/tag";
import { Card, PrimaryButton, SoftButton, selectClass } from "@/components/prototyping/ui";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import { bomTotal, orderQty, type LineMatch, type ProjectBom } from "@/lib/prototyping/bom";
import { cn } from "@/lib/utils";

type Line = ProjectBom["lines"][number];

export function BomTable({
  projectId,
  lines,
  matches,
  loading,
  failed,
  onChoose,
  kicker,
  title,
  intro,
  showTotal,
}: {
  projectId: string;
  lines: Line[];
  matches: Map<string, LineMatch>;
  loading: boolean;
  failed: boolean;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  kicker: string;
  title: string;
  intro: string;
  /** The project-level view shows the running total and "Add all to cart". */
  showTotal: boolean;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const { addItem } = useCart();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const buyable = (l: Line) => {
    const m = matches.get(l.id);
    return m?.product && !m.have && m.status !== "not_stocked" && m.product.stock_status !== "out_of_stock"
      ? m.product
      : null;
  };

  async function add(l: Line) {
    const p = buyable(l);
    if (!p) return;
    setAdding(l.id);
    await addItem(p, orderQty(l.quantity, p.min_order_qty), projectId);
    setAdded((s) => new Set(s).add(l.id));
    setAdding(null);
  }

  async function addAll() {
    setAdding("all");
    for (const l of lines) {
      const p = buyable(l);
      if (p) await addItem(p, orderQty(l.quantity, p.min_order_qty), projectId);
    }
    setAdded(new Set(lines.filter(buyable).map((l) => l.id)));
    setAdding(null);
  }

  const total = bomTotal(lines, matches);
  const anyBuyable = lines.some(buyable);

  return (
    <Card kicker={kicker} title={title} intro={intro}>
      {lines.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("bomEmpty")}</p>
      ) : (
        <>
          {failed && <p className="text-xs font-medium text-destructive">{t("bomMatchFailed")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-start text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-3 pb-2 text-start font-medium">{t("bomColFunction")}</th>
                  <th className="px-3 pb-2 text-start font-medium">{t("bomColSpec")}</th>
                  <th className="px-3 pb-2 text-end font-medium">{t("bomColQty")}</th>
                  <th className="px-3 pb-2 text-start font-medium">{t("bomColProduct")}</th>
                  <th className="px-3 pb-2 text-end font-medium">{t("bomColUnit")}</th>
                  <th className="px-3 pb-2 text-end font-medium">{t("bomColTotal")}</th>
                  <th className="px-3 pb-2 text-start font-medium">{t("bomColStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {lines.map((l) => {
                  const m = matches.get(l.id);
                  const p = m?.product ?? null;
                  const qty = p ? orderQty(l.quantity, p.min_order_qty) : l.quantity;
                  const img = p ? partImageUrl(p) : null;
                  return (
                    <tr key={l.id} id={`bom-${l.id}`} tabIndex={-1} className="align-top outline-none focus:bg-panel">
                      <td className="px-3 py-2.5">
                        <span className="block text-[12.5px] font-semibold text-heading">{l.function}</span>
                        {l.critical && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-inventory">
                            <Star className="h-3 w-3" />
                            {t("bomCritical")}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5 text-[12px] text-mutedtext">{l.spec}</td>
                      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
                        {l.quantity}
                        {p && qty !== l.quantity && (
                          <span className="block text-[10px] text-faint">{t("bomMinOrder", { qty })}</span>
                        )}
                      </td>
                      <td className="min-w-[200px] px-3 py-2.5">
                        {loading && !m ? (
                          <span className="block h-3 w-32 animate-pulse rounded bg-borderstrong/40" />
                        ) : m?.status === "choose" || (m && m.candidates.length > 1 && !m.have) ? (
                          <select
                            value={l.choice && m.candidates.some((c) => c.id === l.choice) ? l.choice : ""}
                            onChange={(e) => void onChoose(l.id, e.target.value || null)}
                            aria-label={t("bomChooseFor", { function: l.function })}
                            className={cn(selectClass, "w-full text-[12px]")}
                          >
                            <option value="">{t("bomChoosePlaceholder", { count: m.candidates.length })}</option>
                            {m.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {`${partName(c, locale)} · ${formatPrice(Number(c.unit_price), locale)} · ${t(`bomStock_${c.stock_status}`)}`}
                              </option>
                            ))}
                          </select>
                        ) : p ? (
                          <Link
                            href={`/store/${encodeURIComponent(p.sku)}`}
                            className="flex items-center gap-2 text-[12.5px] font-medium text-heading hover:text-cobalt"
                          >
                            {img ? (
                              // Store product photo, as the catalogue holds it.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" className="h-9 w-9 shrink-0 rounded-md bg-white object-contain" />
                            ) : (
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-panel text-[8px] text-faint">
                                {t("noPhoto")}
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block">{partName(p, locale)}</span>
                              <span className="block font-mono text-[10px] text-faint">{p.sku}</span>
                            </span>
                          </Link>
                        ) : m?.have ? (
                          <span className="text-[12px] text-heading">{m.have.name}</span>
                        ) : m ? (
                          <span className="text-[12px] text-mutedtext">{t("bomNoMatch")}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
                        {p && !m?.have ? formatPrice(Number(p.unit_price), locale) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
                        {p && !m?.have ? formatPrice(Number(p.unit_price) * qty, locale) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1.5">
                          {m?.status === "have" && (
                            <Tag variant="inventory">{t("bomHave", { count: m.have!.quantity })}</Tag>
                          )}
                          {m?.status === "matched" && (
                            <Tag variant="buy">{m.candidates.length > 1 ? t("bomChosen") : t("bomMatched")}</Tag>
                          )}
                          {m?.status === "choose" && <Tag variant="neutral">{t("bomChoose")}</Tag>}
                          {m?.status === "not_stocked" && <Tag variant="neutral">{t("bomNotStocked")}</Tag>}
                          {p && !m?.have && <StockBadge status={p.stock_status} />}
                          {buyable(l) ? (
                            <SoftButton onClick={() => add(l)} disabled={adding !== null} className="bg-surface">
                              {adding === l.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : added.has(l.id) ? (
                                <Check className="h-3 w-3 text-buy" />
                              ) : (
                                <ShoppingCart className="h-3 w-3" />
                              )}
                              {added.has(l.id) ? t("bomAdded") : t("bomAddToCart")}
                            </SoftButton>
                          ) : m?.status === "not_stocked" ? (
                            <Link
                              href="/contact"
                              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-cobalt hover:text-cobalt-hover"
                            >
                              <MessageSquareQuote className="h-3 w-3" />
                              {t("bomRequestQuote")}
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {showTotal && (
            <div className="flex flex-wrap items-center justify-end gap-4 border-t border-borderstrong/40 pt-3">
              <span className="text-[12px] text-mutedtext">{t("bomTotalNote")}</span>
              <span className="text-sm font-bold text-heading">
                {t("bomTotal")}{" "}
                <span className="font-mono tabular-nums">{formatPrice(total, locale)}</span>
              </span>
              <PrimaryButton onClick={addAll} disabled={!anyBuyable || adding !== null}>
                {adding === "all" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShoppingCart className="h-3.5 w-3.5" />
                )}
                {t("bomAddAll")}
              </PrimaryButton>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

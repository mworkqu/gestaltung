"use client";

// The bill of materials: what to buy, and where to buy it here.
//
// Every line is a function and a spec — from the analysis, the electronics
// builder, or our own rules (with the reason it exists). The product, price
// and stock beside it come live from the store (/api/bom/match). Lines are
// grouped (boards and modules, sensors and actuators, discrete components,
// build consumables, hardware, fabrication), each group collapsible with a
// subtotal. States:
//   matched      one clear, attribute-checked product; price, stock, add to cart
//   choose       several candidates, or only weak (text / incomplete) matches:
//                the client picks, and the pick is saved on the line
//   not stocked  no product; "request a quote", never a made-up item
//   have         already in the client's inventory; left out of every total
//   fabrication  made to order; priced by quote
//   bought       fulfilled by an order; never re-added
// The three money figures are kept apart (CostSummary): available now, not
// stocked, fabrication.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  Info,
  Loader2,
  MessageSquareQuote,
  Package,
  PackageCheck,
  RotateCcw,
  ShoppingCart,
  Star,
  X,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { StockBadge } from "@/components/parts/stock-badge";
import { Tag } from "@/components/ui/tag";
import { Card, PrimaryButton, SoftButton, selectClass } from "@/components/prototyping/ui";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import {
  bomCost,
  buyable,
  groupOf,
  orderQty,
  packOf,
  type LineMatch,
  type ProjectLine,
} from "@/lib/prototyping/bom";
import { BOM_GROUPS, type BomGroup } from "@/lib/store/attributes";
import { cn } from "@/lib/utils";

/** Money now / not stocked / fabrication — three figures, never one total. */
export function CostSummary({
  lines,
  matches,
  compact = false,
}: {
  lines: ProjectLine[];
  matches: Map<string, LineMatch>;
  compact?: boolean;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const c = bomCost(lines, matches);
  const cells = [
    { label: t("costNow"), value: formatPrice(c.availableNow, locale), note: t("costNowNote", { count: c.availableLines }) },
    { label: t("costNotStocked"), value: String(c.notStocked), note: t("costNotStockedNote") },
    { label: t("costFabrication"), value: String(c.fabrication), note: t("costFabricationNote") },
  ];
  return (
    <div className={cn("space-y-1.5", !compact && "rounded-xl bg-panel/60 p-3 shadow-neu-inset")}>
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3")}>
        {cells.map((x) => (
          <div key={x.label} className={cn(compact ? "flex items-baseline justify-between gap-2" : "space-y-0.5")}>
            <p className="text-[10px] uppercase tracking-wider text-faint">{x.label}</p>
            <p className="font-mono text-sm font-bold tabular-nums text-heading">{x.value}</p>
            {!compact && <p className="text-[10.5px] text-mutedtext">{x.note}</p>}
          </div>
        ))}
      </div>
      {(c.toChoose > 0 || c.have > 0 || c.bought > 0) && (
        <p className="text-[10.5px] text-mutedtext">
          {[
            c.toChoose ? t("costToChoose", { count: c.toChoose }) : null,
            c.have ? t("costHave", { count: c.have }) : null,
            c.bought ? t("costBought", { count: c.bought }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export function BomTable({
  projectId,
  lines,
  dismissed,
  matches,
  loading,
  failed,
  onChoose,
  onDismiss,
  kicker,
  title,
  intro,
  showTotal,
  before,
}: {
  projectId: string;
  lines: ProjectLine[];
  /** Lines the client removed (bom.dismissed) among this view's lines. */
  dismissed: ProjectLine[];
  matches: Map<string, LineMatch>;
  loading: boolean;
  failed: boolean;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  onDismiss: (lineIds: string[], removed: boolean) => Promise<void>;
  kicker: string;
  title: string;
  intro: string;
  /** The project-level view: cost summary, Add all to cart, Buy as kit. */
  showTotal: boolean;
  before?: React.ReactNode;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const { addItem, kitDiscountPct } = useCart();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [kitDone, setKitDone] = useState(false);
  const [kitFailed, setKitFailed] = useState(false);
  const [closed, setClosed] = useState<Set<BomGroup>>(new Set());

  const toBuy = lines.filter((l) => buyable(l, matches.get(l.id)));

  async function add(l: ProjectLine) {
    const p = buyable(l, matches.get(l.id));
    if (!p) return;
    setAdding(l.id);
    await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id] });
    setAdded((s) => new Set(s).add(l.id));
    setAdding(null);
  }

  async function addAll() {
    setAdding("all");
    for (const l of toBuy) {
      const p = buyable(l, matches.get(l.id))!;
      await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id] });
    }
    setAdded(new Set(toBuy.map((l) => l.id)));
    setAdding(null);
  }

  /** The whole buyable BOM as one kit: one cart entry, one kit price. */
  async function buyKit() {
    setAdding("kit");
    setKitFailed(false);
    try {
      await ensureSession();
      const { data, error } = await createClient()
        .from("project_kits")
        .insert({ project_id: projectId })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("no kit");
      for (const l of toBuy) {
        const p = buyable(l, matches.get(l.id))!;
        await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id], kitId: data.id as string });
      }
      setKitDone(true);
    } catch {
      setKitFailed(true);
    }
    setAdding(null);
  }

  const groups = BOM_GROUPS.map((g) => ({ g, lines: lines.filter((l) => groupOf(l) === g) })).filter((x) => x.lines.length);

  return (
    <Card kicker={kicker} title={title} intro={intro}>
      {before}
      {showTotal && lines.length > 0 && <CostSummary lines={lines} matches={matches} />}

      {lines.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("bomEmpty")}</p>
      ) : (
        <>
          {failed && <p className="text-xs font-medium text-destructive">{t("bomMatchFailed")}</p>}
          {groups.map(({ g, lines: gl }) => {
            const open = !closed.has(g);
            const sub = bomCost(gl, matches).availableNow;
            return (
              <section key={g} className="space-y-2">
                <button
                  type="button"
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s);
                      if (n.has(g)) n.delete(g);
                      else n.add(g);
                      return n;
                    })
                  }
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 border-b border-borderstrong/40 pb-1.5 text-start"
                >
                  <ChevronDown className={cn("h-4 w-4 text-mutedtext transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
                  <span className="flex-1 text-[13px] font-bold text-heading">
                    {t(`bomGroup_${g}`)} <span className="font-normal text-mutedtext">({gl.length})</span>
                  </span>
                  <span className="text-[11px] text-mutedtext">
                    {g === "fabrication" ? t("byQuote") : t("subtotal", { value: formatPrice(sub, locale) })}
                  </span>
                </button>
                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-start text-sm">
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
                        {gl.map((l) => (
                          <Row
                            key={l.id}
                            l={l}
                            m={matches.get(l.id)}
                            loading={loading}
                            adding={adding}
                            added={added.has(l.id)}
                            onAdd={() => add(l)}
                            onChoose={onChoose}
                            onDismiss={() => onDismiss([l.id], true)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}

          {dismissed.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-mutedtext">
              {t("bomRemovedCount", { count: dismissed.length })}
              <button
                type="button"
                onClick={() => onDismiss(dismissed.map((l) => l.id), false)}
                className="inline-flex items-center gap-1 font-semibold text-cobalt hover:text-cobalt-hover"
              >
                <RotateCcw className="h-3 w-3" />
                {t("bomRestore")}
              </button>
            </p>
          )}

          {showTotal && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-borderstrong/40 pt-3">
              <span className="me-auto text-[12px] text-mutedtext">{t("bomTotalNote")}</span>
              {kitDone ? (
                <Link href="/store/cart" className="inline-flex items-center gap-1 text-xs font-semibold text-buy">
                  <PackageCheck className="h-3.5 w-3.5" />
                  {t("kitAdded")}
                </Link>
              ) : (
                <SoftButton onClick={buyKit} disabled={!toBuy.length || adding !== null} title={t("kitHint")}>
                  {adding === "kit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                  {kitDiscountPct > 0 ? t("buyKitDiscount", { pct: kitDiscountPct }) : t("buyKit")}
                </SoftButton>
              )}
              <PrimaryButton onClick={addAll} disabled={!toBuy.length || adding !== null}>
                {adding === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                {t("bomAddAll")}
              </PrimaryButton>
              {kitFailed && <p className="w-full text-end text-[11.5px] text-destructive">{t("kitFailed")}</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Row({
  l,
  m,
  loading,
  adding,
  added,
  onAdd,
  onChoose,
  onDismiss,
}: {
  l: ProjectLine;
  m: LineMatch | undefined;
  loading: boolean;
  adding: string | null;
  added: boolean;
  onAdd: () => void;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  onDismiss: () => void;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const p = m?.product ?? null;
  const packs = p ? orderQty(l.quantity, p) : null;
  const pack = p ? packOf(p) : 1;
  const img = p ? partImageUrl(p) : null;
  const canBuy = buyable(l, m);
  const showPicker = !l.fulfilled && m && !m.have && m.candidates.length > 0 && (m.candidates.length > 1 || m.status === "choose");

  return (
    <tr id={`bom-${l.id}`} tabIndex={-1} className="align-top outline-none focus:bg-panel">
      <td className="max-w-[240px] px-3 py-2.5">
        <span className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-heading">{l.function}</span>
            {l.critical && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-inventory">
                <Star className="h-3 w-3" />
                {t("bomCritical")}
              </span>
            )}
            {l.reason && (
              <span className="mt-0.5 block text-[10.5px] leading-snug text-mutedtext">
                <span className="font-semibold">{t("ruleWhy")}</span> {l.reason}
              </span>
            )}
          </span>
          {!l.fulfilled && (
            <button
              type="button"
              onClick={onDismiss}
              title={t("bomRemove")}
              aria-label={t("bomRemove")}
              className="mt-0.5 rounded p-0.5 text-faint transition-colors hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      </td>
      <td className="max-w-[200px] px-3 py-2.5 text-[12px] text-mutedtext">{l.spec}</td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {l.quantity}
        {p && (pack > 1 || (packs ?? 0) * pack !== l.quantity) && (
          <span className="block whitespace-nowrap font-sans text-[10px] text-faint">
            {pack > 1 ? t("bomPacks", { needs: l.quantity, pack, packs: packs ?? 0 }) : t("bomMinOrder", { qty: packs ?? 0 })}
          </span>
        )}
      </td>
      <td className="min-w-[210px] px-3 py-2.5">
        {l.fulfilled ? (
          <span className="text-[12px] text-heading">
            {l.fulfilled.sku} <span className="text-mutedtext">× {l.fulfilled.quantity}</span>
          </span>
        ) : groupOf(l) === "fabrication" ? (
          <span className="text-[12px] text-mutedtext">{t("bomMadeToOrder")}</span>
        ) : loading && !m ? (
          <span className="block h-3 w-32 animate-pulse rounded bg-borderstrong/40" />
        ) : showPicker ? (
          <div className="space-y-1">
            <select
              value={l.choice && m!.candidates.some((c) => c.id === l.choice) ? l.choice : ""}
              onChange={(e) => void onChoose(l.id, e.target.value || null)}
              aria-label={t("bomChooseFor", { function: l.function })}
              className={cn(selectClass, "w-full text-[12px]")}
            >
              <option value="">{t("bomChoosePlaceholder", { count: m!.candidates.length })}</option>
              {m!.candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.strength === "weak" ? `${t("weakPrefix")} ` : ""}${partName(c, locale)} · ${formatPrice(Number(c.unit_price), locale)} · ${t(`bomStock_${c.stock_status}`)}`}
                </option>
              ))}
            </select>
            {p && <Why c={p} />}
          </div>
        ) : p ? (
          <div className="space-y-1">
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
            <Why c={p} />
          </div>
        ) : m?.have ? (
          <span className="text-[12px] text-heading">{m.have.name}</span>
        ) : m ? (
          <span className="text-[12px] text-mutedtext">{t("bomNoMatch")}</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {p && !m?.have && !l.fulfilled ? formatPrice(Number(p.unit_price), locale) : "—"}
      </td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {p && !m?.have && !l.fulfilled && packs ? formatPrice(Number(p.unit_price) * packs, locale) : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col items-start gap-1.5">
          {l.fulfilled ? (
            <Tag variant="buy">
              <PackageCheck className="h-3 w-3" />
              {t("bomBought")}
            </Tag>
          ) : groupOf(l) === "fabrication" ? (
            <Tag variant="neutral">{t("bomFabrication")}</Tag>
          ) : m?.status === "have" ? (
            <Tag variant="inventory">{t("bomHave", { count: m.have!.quantity })}</Tag>
          ) : m?.status === "matched" ? (
            <Tag variant="buy">{l.choice ? t("bomChosen") : t("bomMatched")}</Tag>
          ) : m?.status === "choose" ? (
            <Tag variant="neutral">{m.candidates.every((c) => c.strength === "weak") ? t("bomWeakOnly") : t("bomChoose")}</Tag>
          ) : m?.status === "not_stocked" ? (
            <Tag variant="neutral">{t("bomNotStocked")}</Tag>
          ) : null}
          {p && !m?.have && !l.fulfilled && <StockBadge status={p.stock_status} />}
          {canBuy ? (
            <SoftButton onClick={onAdd} disabled={adding !== null} className="bg-surface">
              {adding === l.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : added ? (
                <Check className="h-3 w-3 text-buy" />
              ) : (
                <ShoppingCart className="h-3 w-3" />
              )}
              {added ? t("bomAdded") : t("bomAddToCart")}
            </SoftButton>
          ) : !l.fulfilled && (m?.status === "not_stocked" || groupOf(l) === "fabrication") ? (
            <Link
              href={groupOf(l) === "fabrication" ? "/design/quote" : "/contact"}
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
}

/** Why a product matched: attribute checks, or a weak text match, in words. */
function Why({ c }: { c: NonNullable<LineMatch["product"]> }) {
  const t = useTranslations("Prototyping");
  return (
    <p className="flex items-start gap-1 text-[10.5px] leading-snug text-mutedtext" title={c.why.join("\n")}>
      <Info className="mt-px h-3 w-3 shrink-0" />
      <span>
        {c.strength === "weak" && <span className="font-semibold text-inventory">{t("weakMatch")} </span>}
        {c.why.slice(0, 3).join(" · ")}
      </span>
    </p>
  );
}

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
//   choose       several candidates: the client picks, and the pick is saved
//                on the line. Only weak (text / incomplete) matches: "No
//                confident match" and "Suggested: … — confirm?"; a weak product
//                is never shown as the line's product until the client picks it
//   not stocked  no product; "request a quote", never a made-up item
//   have         already in the client's inventory; left out of every total
//   fabrication  made to order; priced by quote
//   ordered      fulfilled by an order; never re-added. Shows the order and its
//                live status ("Ordered #1a2b3c4d · Shipped", "Delivered"), read
//                from part_orders (own orders only, RLS); the plain "Bought"
//                when the marker has no order id or the status cannot be read
// The three figures are kept apart (CostSummary): to buy now (what the client
// would pay — whole packs, so a line sold in packs larger than it needs counts
// at the pack price, and the summary says so), not stocked, fabrication.
// The matcher's reasons (`why`) are debug text: shown to super_admin only.

import { useEffect, useState } from "react";
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
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
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
import { packLineCount, weakSuggestion } from "@/lib/prototyping/bom-match";
import { fulfilledLabel, fulfilledOrderIds } from "@/lib/prototyping/fulfilled";
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
  const packLines = packLineCount(lines, matches);
  const cells = [
    { label: t("costToBuyNow"), value: formatPrice(c.availableNow, locale), note: t("costNowNote", { count: c.availableLines }) },
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
      {packLines > 0 && <p className="text-[10.5px] text-inventory">{t("costPacksNote", { count: packLines })}</p>}
      {(c.toChoose > 0 || c.have > 0 || c.bought > 0) && (
        <p className="text-[10.5px] text-mutedtext">
          {[
            c.toChoose ? t("costToChoose", { count: c.toChoose }) : null,
            c.have ? t("costHave", { count: c.have }) : null,
            c.bought ? t("costOrdered", { count: c.bought }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

/**
 * Whether the signed-in caller is a super_admin (own profile row, RLS), read
 * once. False until known, for guests, and when the read fails (logged).
 */
function useIsSuperAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || cancelled) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: string }>();
      if (cancelled) return;
      if (error) {
        console.error("bom: role lookup failed", error);
        return;
      }
      setAdmin(data?.role === "super_admin");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return admin;
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
  inCircuit,
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
  /** Line ids a part of the stored circuit points at (netlist bomIds): these can't be removed. */
  inCircuit?: ReadonlySet<string>;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const { addItem, kitDiscountPct } = useCart();
  const admin = useIsSuperAdmin();
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [kitDone, setKitDone] = useState(false);
  const [kitFailed, setKitFailed] = useState(false);
  const [closed, setClosed] = useState<Set<BomGroup>>(new Set());
  // Order id → status for the lines an order fulfilled; null until read or
  // when the read fails (those lines then keep the plain label).
  const [orderStatuses, setOrderStatuses] = useState<Map<string, string> | null>(null);
  const orderIdsKey = fulfilledOrderIds(lines).join(",");

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
        if (error) {
          console.error("bom: order status lookup failed", error);
          setOrderStatuses(null);
          return;
        }
        setOrderStatuses(new Map((data ?? []).map((o) => [o.id as string, o.status as string])));
      });
    return () => {
      cancelled = true;
    };
  }, [orderIdsKey]);

  const toBuy = lines.filter((l) => buyable(l, matches.get(l.id)));

  async function add(l: ProjectLine) {
    const p = buyable(l, matches.get(l.id));
    if (!p) return;
    setAdding(l.id);
    // A failed add is shown by the cart (useCart().error); only mark saved lines.
    if (await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id] })) setAdded((s) => new Set(s).add(l.id));
    setAdding(null);
  }

  async function addAll() {
    setAdding("all");
    const saved = new Set<string>();
    for (const l of toBuy) {
      const p = buyable(l, matches.get(l.id))!;
      if (await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id] })) saved.add(l.id);
    }
    setAdded(saved);
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
        const ok = await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id], kitId: data.id as string });
        if (!ok) throw new Error("kit line not saved");
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
                            orderStatuses={orderStatuses}
                            admin={admin}
                            onAdd={() => add(l)}
                            onChoose={onChoose}
                            onDismiss={() => onDismiss([l.id], true)}
                            dismissBlocked={!!inCircuit?.has(l.id)}
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
  orderStatuses,
  admin,
  onAdd,
  onChoose,
  onDismiss,
  dismissBlocked,
}: {
  l: ProjectLine;
  m: LineMatch | undefined;
  loading: boolean;
  adding: string | null;
  added: boolean;
  orderStatuses: Map<string, string> | null;
  /** super_admin: show the matcher's reasons. */
  admin: boolean;
  onAdd: () => void;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  onDismiss: () => void;
  /** The line's part is drawn in the circuit: removing it would split the views (audit #1). */
  dismissBlocked: boolean;
}) {
  const t = useTranslations("Prototyping");
  const tD = useTranslations("Delivery");
  const tO = useTranslations("PartsDashboard");
  const locale = useLocale();
  const p = m?.product ?? null;
  const done = fulfilledLabel(l.fulfilled, orderStatuses);
  const packs = p ? orderQty(l.quantity, p) : null;
  const pack = p ? packOf(p) : 1;
  const img = p ? partImageUrl(p) : null;
  const canBuy = buyable(l, m);
  const [confirming, setConfirming] = useState(false);
  // Only weak matches and no pick: a suggestion to confirm, never the product.
  const suggestion = l.fulfilled ? null : weakSuggestion(m);
  // A weak product the client picked stays un-pickable from the list.
  const weakPick = !!(p && l.choice && p.strength === "weak");
  const showPicker =
    !l.fulfilled &&
    !!m &&
    !m.have &&
    m.candidates.length > 0 &&
    (m.candidates.length > 1 || m.status === "choose" || weakPick);
  // A line the client would still pay for (whole packs).
  const buying = p && !m?.have && !l.fulfilled ? p : null;

  async function confirm(id: string) {
    setConfirming(true);
    await onChoose(l.id, id);
    setConfirming(false);
  }

  const picker =
    showPicker && m ? (
      <select
        value={l.choice && m.candidates.some((c) => c.id === l.choice) ? l.choice : ""}
        onChange={(e) => void onChoose(l.id, e.target.value || null)}
        aria-label={t("bomChooseFor", { function: l.function })}
        className={cn(selectClass, "w-full text-[12px]")}
      >
        <option value="">{t("bomChoosePlaceholder", { count: m.candidates.length })}</option>
        {m.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {`${c.strength === "weak" ? `${t("weakPrefix")} ` : ""}${partName(c, locale)} · ${formatPrice(Number(c.unit_price), locale)} · ${tD(`lt_${c.lead_time_class ?? "on_request"}`)}`}
          </option>
        ))}
      </select>
    ) : null;

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
          {!l.fulfilled &&
            (dismissBlocked ? (
              // Disabled buttons swallow hover in some browsers: the reason sits on a wrapper.
              <span title={t("dismissBlockedCircuit")} className="mt-0.5 inline-flex">
                <button
                  type="button"
                  disabled
                  aria-label={t("dismissBlockedCircuit")}
                  className="cursor-not-allowed rounded p-0.5 text-faint opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                title={t("bomRemove")}
                aria-label={t("bomRemove")}
                className="mt-0.5 rounded p-0.5 text-faint transition-colors hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            ))}
        </span>
      </td>
      <td className="max-w-[200px] px-3 py-2.5 text-[12px] text-mutedtext">{l.spec}</td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {l.quantity}
        {buying && pack === 1 && packs !== l.quantity && (
          <span className="block whitespace-nowrap font-sans text-[10px] text-faint">{t("bomMinOrder", { qty: packs ?? 0 })}</span>
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
        ) : suggestion ? (
          <div className="space-y-1">
            <span className="block text-[12px] font-medium text-inventory">{t("noConfidentMatch")}</span>
            <button
              type="button"
              onClick={() => void confirm(suggestion.id)}
              disabled={confirming}
              className="inline-flex items-center gap-1 text-start text-[11.5px] font-semibold text-cobalt hover:text-cobalt-hover disabled:opacity-60"
            >
              {confirming && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("suggestedConfirm", { name: partName(suggestion, locale) })}
            </button>
            {m!.candidates.length > 1 && picker}
            {admin && <Why c={suggestion} />}
          </div>
        ) : showPicker ? (
          <div className="space-y-1">
            {picker}
            {p && admin && <Why c={p} />}
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
            {admin && <Why c={p} />}
          </div>
        ) : m?.have ? (
          <span className="text-[12px] text-heading">{m.have.name}</span>
        ) : m ? (
          <span className="text-[12px] text-mutedtext">{t("bomNoMatch")}</span>
        ) : null}
        {buying && pack > 1 && (
          <span className="mt-1 block text-[10.5px] leading-snug text-inventory">
            {t("packLine", { need: l.quantity, pack, price: formatPrice(Number(buying.unit_price), locale) })}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {/* The store's unit price whenever the product is known, bought lines too. */}
        {p ? formatPrice(Number(p.unit_price), locale) : "—"}
      </td>
      <td className="px-3 py-2.5 text-end font-mono text-[12px] tabular-nums text-heading">
        {buying && packs ? formatPrice(Number(buying.unit_price) * packs, locale) : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col items-start gap-1.5">
          {done ? (
            <Tag variant={done.kind === "ordered" && done.status === "cancelled" ? "neutral" : "buy"}>
              <PackageCheck className="h-3 w-3" />
              {done.kind === "ordered"
                ? t("bomOrdered", { id: done.ref, status: tO(`order_status_${done.status}`) })
                : done.kind === "delivered"
                  ? t("bomDelivered")
                  : t("bomBought")}
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
          {p && !m?.have && !l.fulfilled && <LeadTimeBadge leadClass={p.lead_time_class} />}
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

/** Why a product matched: attribute checks, or a weak text match, in words. super_admin only. */
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

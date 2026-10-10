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
//                on the line. Only weak (text / incomplete) matches: the client
//                reads "We'll pick this part for you" (no guess, no picker);
//                super_admin sees "No confident match", "Suggested: … —
//                confirm?" and the chooser (P5-01)
//   not stocked  no product, never a made-up item: "We'll source this". All of a table's
//                not-stocked lines go in ONE quote request (QuoteRequest)
//   have         already in the client's inventory; left out of every total
//   fabrication  made to order; priced by quote
//   ordered      fulfilled by an order; never re-added. Shows the order and its
//                live status ("Ordered #1a2b3c4d · Shipped", "Delivered"), read
//                from part_orders (own orders only, RLS); the plain "Bought"
//                when the marker has no order id or the status cannot be read
// CostSummary shows ONE money figure — to buy now (what the client would pay,
// whole packs, so a line sold in packs larger than it needs counts at the pack
// price, and the summary says so) — and, apart from it, a line of counts (audit
// #26). Group subtotals are the still-to-buy lines, plus what the group's
// ordered lines cost (audit #27). One buy action: the whole buyable list as a
// project kit (audit #28) — since P3-06 a prominent box at the TOP of the
// project BOM, right under the cost summary, with "Also useful" (three more
// products from the same store categories) beneath it. Lines two sources both listed show once
// (dedupeLines, audit #29); group counts come from the shared groupLines.
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
import { PhoneInput } from "@/components/phone-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { Card, PrimaryButton, SoftButton, selectClass } from "@/components/prototyping/ui";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser } from "@/lib/supabase/guest";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import {
  bomCost,
  buyable,
  dedupeLines,
  groupLines,
  groupOf,
  orderQty,
  packOf,
  unstockedLines,
  type LineMatch,
  type ProjectLine,
} from "@/lib/prototyping/bom";
import { packLineCount, weakSuggestion } from "@/lib/prototyping/bom-match";
import { costOfLines, type CostState } from "@/lib/prototyping/bom-cost";
import { cartLineIds, kitPlan } from "@/lib/prototyping/kit-plan";
import { arabicCountForm } from "@/lib/text/count";
import { fulfilledLabel, fulfilledOrderIds } from "@/lib/prototyping/fulfilled";
import type { BomGroup } from "@/lib/store/attributes";
import { cn } from "@/lib/utils";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import type { StoreCardPart } from "@/lib/store/catalog";
import { track } from "@/lib/analytics";
import { AlsoUseful } from "@/components/prototyping/also-useful";
import { MIN_ALSO_USEFUL } from "@/lib/store/also-useful-relevance";

/**
 * ONE money figure — to buy now — and, on its own line, the counts: not
 * stocked, to fabricate, ordered (audit #26). Money and counts never share a row.
 */
/** A product name cut to its model: "ESP32-S3 DevKitC-1 N16R8 Development Board" → "ESP32-S3 DevKitC-1 N16R8". */
function shortModel(name: string): string {
  const head = name.split(/\s[–—-]\s|,/)[0].replace(/\b(development|module|board|sensor|kit)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return (head || name).slice(0, 36);
}

export function CostSummary({
  lines: given,
  matches,
  compact = false,
  state = "ready",
}: {
  lines: ProjectLine[];
  matches: Map<string, LineMatch>;
  compact?: boolean;
  /** Until the first store match arrives there are no prices: a skeleton, never QAR 0.00 (audit #59). */
  state?: CostState;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  if (state !== "ready") {
    return (
      <div
        className={cn("space-y-2", !compact && "rounded-xl bg-panel/60 p-3 shadow-neu-inset")}
        aria-busy={state === "loading"}
      >
        <p className="text-[10px] uppercase tracking-wider text-faint">{t("costToBuyNow")}</p>
        {state === "loading" ? (
          <>
            <span className="sr-only">{t("costLoading")}</span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2.5 w-full max-w-[14rem]" />
          </>
        ) : (
          <p className="text-[10.5px] text-mutedtext">{t("costUnavailable")}</p>
        )}
      </div>
    );
  }
  const lines = dedupeLines(given);
  const c = costOfLines(given, matches);
  const packLines = packLineCount(lines, matches);
  const counts = [
    t("costCounts", { notStocked: c.notStocked, fabrication: c.fabrication, ordered: c.bought }),
    c.toChoose ? t("costToChoose", { count: c.toChoose }) : null,
    c.wePick ? t("costWePick", { count: c.wePick }) : null,
    c.have ? t("costHave", { count: c.have }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cn("space-y-1.5", !compact && "rounded-xl bg-panel/60 p-3 shadow-neu-inset")}>
      <div className={cn("flex items-baseline gap-2", compact ? "justify-between" : "flex-wrap")}>
        <p className="text-[10px] uppercase tracking-wider text-faint">{t("costToBuyNow")}</p>
        <p className="font-mono text-sm font-bold tabular-nums text-heading">{formatPrice(c.availableNow, locale)}</p>
        {!compact && <p className="text-[10.5px] text-mutedtext">{t("costNowNote", { count: c.availableLines })}</p>}
      </div>
      {packLines > 0 && <p className="text-[10.5px] text-inventory">{t("costPacksNote", { count: packLines })}</p>}
      <p className="border-t border-dashed border-borderstrong/50 pt-1.5 text-[10.5px] text-mutedtext">{counts}</p>
    </div>
  );
}

/**
 * One quote request for every line we don't stock (audit #28): the list goes
 * to the owner once, through the lead path the contact form uses
 * (/api/store-lead, source bom_quote: saved to inquiries and emailed with the
 * items, the note and a link to the project), with a single confirmation and
 * a single success message.
 *
 * P1-11 / CC-1: with a phone on the profile the phone field is skipped and the
 * stored number is sent; otherwise the typed number is saved to the profile
 * after a successful request, so it is never asked again.
 */
function QuoteRequest({
  projectId,
  lines,
  profilePhone,
  onPhoneSaved,
}: {
  projectId: string;
  lines: ProjectLine[];
  profilePhone?: string | null;
  onPhoneSaved?: (phone: string) => void;
}) {
  const t = useTranslations("Prototyping");
  const tC = useTranslations("Contact");
  const tD = useTranslations("Delivery");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const typedPhone = String(f.get("phone") ?? "").trim();
    setState("sending");
    try {
      // The route writes the message (items, note, project link and name).
      const res = await fetch("/api/store-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(f.get("name") ?? "").trim(),
          phone: profilePhone || typedPhone,
          email: String(f.get("email") ?? "").trim(),
          note: String(f.get("note") ?? "").trim(),
          items: lines.map((l) => ({ function: l.function, spec: l.spec, quantity: l.quantity })),
          projectId,
          locale,
          source: "bom_quote",
        }),
      });
      if (!res.ok) throw new Error(`store-lead ${res.status}`);
      setState("sent");
      if (!profilePhone && isValidPhone(typedPhone)) {
        // Best-effort: the request went out either way.
        const user = await getCurrentUser();
        if (user) {
          const phone = normalizePhone(typedPhone);
          const { error } = await createClient().from("profiles").update({ phone }).eq("id", user.id);
          if (!error) onPhoneSaved?.(phone);
        }
      }
    } catch (err) {
      console.error("bom: quote request failed", err);
      setState("error");
    }
  }

  const field =
    "w-full rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

  return (
    <>
      {state === "sent" ? (
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-buy">
          <Check className="h-3.5 w-3.5" />
          {tC("success")}
        </p>
      ) : (
        <SoftButton onClick={() => setOpen(true)}>
          <MessageSquareQuote className="h-3.5 w-3.5" />
          {t("bomRequestQuoteAll", { count: lines.length })}
        </SoftButton>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("bomRequestQuote")}
            className="neu max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-heading">{t("bomRequestQuote")}</h2>
                <p className="mt-1 text-xs text-mutedtext">{t("bomQuoteHelp")}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={tD("close")} className="text-mutedtext hover:text-heading max-md:tap-hit">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-panel/60 p-3 text-[12px] shadow-neu-inset">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold text-heading">{l.function}</span>
                    {l.spec && <span className="block text-[11px] text-mutedtext">{l.spec}</span>}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-heading">× {l.quantity}</span>
                </li>
              ))}
            </ul>
            {state === "sent" ? (
              <p className="flex items-center gap-2 text-sm font-medium text-buy">
                <Check className="h-4 w-4" />
                {tC("success")}
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-mutedtext">{tC("nameLabel")}</span>
                  <input name="name" required autoFocus placeholder={tC("namePlaceholder")} className={field} />
                </label>
                {!profilePhone && (
                  <div className="space-y-1">
                    <label htmlFor="bom-quote-phone" className="block text-[11px] font-semibold text-mutedtext">
                      {tC("whatsappLabel")}
                    </label>
                    <PhoneInput
                      id="bom-quote-phone"
                      name="phone"
                      placeholder={tC("whatsappPlaceholder")}
                      codeAriaLabel={tC("countryCode")}
                    />
                  </div>
                )}
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-mutedtext">{tC("emailOptional")}</span>
                  <input name="email" type="email" dir="ltr" placeholder={tC("emailPlaceholder")} className={field} />
                </label>
                <textarea name="note" rows={2} placeholder={t("bomQuoteNote")} className={cn(field, "resize-y")} />
                {state === "error" && <p className="text-sm text-destructive">{tC("errorSubmit")}</p>}
                <PrimaryButton type="submit" disabled={state === "sending"} className="w-full justify-center">
                  {state === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("bomQuoteSubmit")}
                </PrimaryButton>
              </form>
            )}
          </div>
        </div>
      )}
    </>
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
    void getCurrentUser().then(async (user) => {
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
  lines: given,
  dismissed,
  matches,
  loading,
  failed,
  costState = "ready",
  onChoose,
  onDismiss,
  kicker,
  title,
  intro,
  showTotal,
  before,
  inCircuit,
  profilePhone,
  onPhoneSaved,
  alsoUseful,
}: {
  projectId: string;
  lines: ProjectLine[];
  /** Lines the client removed (bom.dismissed) among this view's lines. */
  dismissed: ProjectLine[];
  matches: Map<string, LineMatch>;
  loading: boolean;
  failed: boolean;
  /** "loading" until the first store match is back, so the summary is a skeleton, not QAR 0.00 (audit #59). */
  costState?: CostState;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  onDismiss: (lineIds: string[], removed: boolean) => Promise<void>;
  kicker: string;
  title: string;
  intro: string;
  /** The project-level view: cost summary and the one kit button. */
  showTotal: boolean;
  before?: React.ReactNode;
  /** Line ids a part of the stored circuit points at (netlist bomIds): these can't be removed. */
  inCircuit?: ReadonlySet<string>;
  /** profiles.phone: the quote request skips its phone field when set (P1-11 / CC-1). */
  profilePhone?: string | null;
  onPhoneSaved?: (phone: string) => void;
  /** Project view only: "Also useful" products under the kit box (P3-06, from /api/bom/match). */
  alsoUseful?: StoreCardPart[];
}) {
  const t = useTranslations("Prototyping");
  const tU = useTranslations("Upsell");
  const locale = useLocale();
  const { addItem, addKit, kitDiscountPct, items: cartItems } = useCart();
  const admin = useIsSuperAdmin();
  // One line per item, whichever view renders this table (audit #29).
  const lines = dedupeLines(given, { keep: inCircuit });
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

  const unstocked = unstockedLines(lines, matches);
  // Lines this project's cart already holds (kit or loose): "In your cart", never added twice.
  const inCart = cartLineIds(cartItems, projectId);
  // The ONE plan: the button's count and total are computed from the rows it writes (P5-02).
  const plan = kitPlan(lines, matches, { inCart, discountPct: kitDiscountPct });
  const pricesReady = (costState ?? "ready") === "ready";

  async function add(l: ProjectLine) {
    const p = buyable(l, matches.get(l.id));
    if (!p) return;
    setAdding(l.id);
    // A failed add is shown by the cart (useCart().error); only mark saved lines.
    if (await addItem(p, orderQty(l.quantity, p), projectId, { bomLines: [l.id] })) setAdded((s) => new Set(s).add(l.id));
    setAdding(null);
  }

  /**
   * The ONE buy action (audit #28): every line we sell, as a project kit — one
   * cart entry, the kit discount, fulfilment tracked per line. One write, all
   * or nothing (cart-provider addKit), so a kit is never half added (P5-02).
   */
  async function buyKit() {
    if (!plan.rows.length) return;
    setAdding("kit");
    setKitFailed(false);
    const kitId = await addKit(
      projectId,
      plan.rows.map((r) => ({ part: r.product, quantity: r.quantity, bomLines: r.bomLines }))
    );
    if (kitId) {
      setKitDone(true);
      // Kit attach rate (P3-06): the kit as the cart prices it.
      track("kit_added", { lines: plan.add.length, total_qar: plan.total });
    } else setKitFailed(true);
    setAdding(null);
  }

  // The same grouping (and so the same counts) in every view (audit #29).
  const groups = groupLines(lines);

  /** A group's money: its still-to-buy lines, and what its ordered lines cost — never a bare QAR 0.00. */
  const groupMoney = (g: BomGroup, gl: ProjectLine[]) => {
    if (g === "fabrication") return t("byQuote");
    const c = bomCost(gl, matches);
    const parts = [
      c.availableLines > 0 ? t("subtotal", { value: formatPrice(c.availableNow, locale) }) : null,
      c.orderedPriced > 0 ? t("groupOrdered", { amount: formatPrice(c.ordered, locale) }) : null,
    ].filter(Boolean);
    if (!parts.length && c.notStocked > 0) return t("byQuote");
    return parts.join(" · ");
  };

  return (
    <Card kicker={kicker} title={title} intro={intro}>
      {before}
      {showTotal && lines.length > 0 && <CostSummary lines={lines} matches={matches} state={costState} />}

      {/* The ONE kit button (audit #28), prominent at the top since P3-06. */}
      {showTotal && lines.length > 0 && pricesReady && (plan.add.length > 0 || plan.inCart.length > 0 || kitDone || adding === "kit") && (
        <div className="space-y-2 rounded-xl bg-panel/60 p-3 shadow-neu-inset sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-heading">
                <Package className="h-4 w-4 text-cobalt" />
                {tU("kitTitle")}
              </p>
              <p className="text-[11.5px] text-mutedtext">{tU("kitText")}</p>
            </div>
            {kitDone || plan.add.length === 0 ? (
              <Link href="/store/cart" className="inline-flex items-center gap-1 text-xs font-semibold text-buy max-md:min-h-11">
                <PackageCheck className="h-3.5 w-3.5" />
                {kitDone ? t("kitAdded") : t("kitAllInCart")}
              </Link>
            ) : (
              <PrimaryButton onClick={buyKit} disabled={adding !== null} title={t("kitHint")} className="justify-center max-md:w-full">
                {adding === "kit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                {t("addKitPlan", {
                  n: plan.add.length,
                  count: String(plan.add.length),
                  form: arabicCountForm(plan.add.length),
                  total: formatPrice(plan.total, locale),
                })}
              </PrimaryButton>
            )}
          </div>
          {!kitDone && plan.add.length > 0 && kitDiscountPct > 0 && (
            <p className="text-end text-[11px] text-buy">{t("kitDiscountIncluded", { pct: String(kitDiscountPct) })}</p>
          )}
          {!kitDone && plan.add.length > 0 && plan.inCart.length > 0 && (
            <p className="text-[11.5px] text-mutedtext">
              {t("kitAlreadyInCart", { n: plan.inCart.length, count: String(plan.inCart.length), form: arabicCountForm(plan.inCart.length) })}
            </p>
          )}
          {plan.sourced.length > 0 && (
            <p className="text-[11.5px] text-mutedtext">
              <span className="font-semibold text-heading">
                {t("kitWeSource", { n: plan.sourced.length, count: String(plan.sourced.length), form: arabicCountForm(plan.sourced.length) })}
              </span>{" "}
              {[...new Set(plan.sourced.map((x) => x.name))].join(" · ")}
            </p>
          )}
          {kitFailed && <p className="text-end text-[11.5px] text-destructive">{t("kitFailed")}</p>}
        </div>
      )}
      {showTotal && lines.length > 0 && alsoUseful && alsoUseful.length >= MIN_ALSO_USEFUL && <AlsoUseful parts={alsoUseful} />}

      {lines.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("bomEmpty")}</p>
      ) : (
        <>
          {failed && <p className="text-xs font-medium text-destructive">{t("bomMatchFailed")}</p>}
          {unstocked.length > 0 && (
            <div className="flex justify-end">
              <QuoteRequest projectId={projectId} lines={unstocked} profilePhone={profilePhone} onPhoneSaved={onPhoneSaved} />
            </div>
          )}
          {groups.map(({ g, lines: gl }) => {
            const open = !closed.has(g);
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
                  className="flex w-full items-center gap-2 border-b border-borderstrong/40 pb-1.5 text-start max-md:min-h-11"
                >
                  <ChevronDown className={cn("h-4 w-4 text-mutedtext transition-transform", !open && "-rotate-90 rtl:rotate-90")} />
                  <span className="flex-1 text-[13px] font-bold text-heading">
                    {t(`bomGroup_${g}`)} <span className="font-normal text-mutedtext">({gl.length})</span>
                  </span>
                  <span className="text-[11px] text-mutedtext">{groupMoney(g, gl)}</span>
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
                            inCart={inCart.has(l.id)}
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
                className="inline-flex items-center gap-1 font-semibold text-cobalt hover:text-cobalt-hover max-md:tap-hit"
              >
                <RotateCcw className="h-3 w-3" />
                {t("bomRestore")}
              </button>
            </p>
          )}

          {showTotal && (
            <p className="border-t border-borderstrong/40 pt-3 text-[12px] text-mutedtext">{t("bomTotalNote")}</p>
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
  inCart,
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
  /** A cart line of this project holds this BOM line. */
  inCart: boolean;
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
            {`${partName(c, locale)} · ${formatPrice(Number(c.unit_price), locale)} · ${tD(`lt_${c.lead_time_class ?? "on_request"}`)}`}
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
                  className="cursor-not-allowed rounded p-0.5 text-faint opacity-40 max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center"
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
                className="mt-0.5 rounded p-0.5 text-faint transition-colors hover:text-destructive max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center"
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
        ) : suggestion && !admin ? (
          // Only weak candidates: the client never sees a guess, we pick the part (P5-01).
          <span className="text-[12px] font-medium text-heading">{t("bomWePick")}</span>
        ) : suggestion ? (
          <div className="space-y-1">
            <span className="block text-[12px] font-medium text-inventory">{t("noConfidentMatch")}</span>
            <button
              type="button"
              onClick={() => void confirm(suggestion.id)}
              disabled={confirming}
              className="inline-flex items-center gap-1 text-start text-[11.5px] font-semibold text-cobalt hover:text-cobalt-hover disabled:opacity-60 max-md:tap-hit"
            >
              {confirming && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("suggestedConfirm", { name: partName(suggestion, locale) })}
            </button>
            {m!.candidates.length > 1 && picker}
            {admin && <Why c={suggestion} />}
          </div>
        ) : showPicker && !p ? (
          <div className="space-y-1">
            {picker}
          </div>
        ) : p ? (
          <div className="space-y-1">
            <Link
              href={`/store/${encodeURIComponent(p.sku)}`}
              className="flex items-center gap-3 text-[12.5px] font-medium text-heading hover:text-cobalt"
            >
              {img ? (
                // Store product photo, big enough to see what you're buying (owner, 2026-09-29).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sizedImage(img, IMAGE_WIDTHS.thumb)!}
                  alt={partName(p, locale)}
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-lg bg-white object-contain shadow-neu-sm"
                />
              ) : (
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-panel text-[9px] text-faint">
                  {t("noPhoto")}
                </span>
              )}
              <span className="min-w-0">
                <span className="block">{partName(p, locale)}</span>
                <span className="block font-mono text-[10px] text-faint">{p.sku}</span>
              </span>
            </Link>
            {/* Our pick, with the other models one click away (owner, 2026-09-29). */}
            {/* The other confident models, one click away (owner, 2026-09-29); never a weak guess for the client. */}
            {m && !m.have && !l.fulfilled && m.candidates.length > 1 && (
              <div className="space-y-0.5 text-[11px]">
                {m.candidates.filter((c) => c.id !== p.id && (admin || c.strength === "strong")).length > 0 && (
                  <span className="block text-mutedtext">
                    {t("bomAlternatives")}{" "}
                    {m.candidates
                      .filter((c) => c.id !== p.id && (admin || c.strength === "strong"))
                      .map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && " · "}
                          <button
                            type="button"
                            disabled={confirming}
                            onClick={() => void confirm(c.id)}
                            title={`${partName(c, locale)} · ${formatPrice(Number(c.unit_price), locale)}`}
                            className="inline-flex items-center gap-1 align-middle font-medium text-cobalt hover:underline disabled:opacity-60 max-md:tap-hit"
                          >
                            {partImageUrl(c) && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={sizedImage(partImageUrl(c), IMAGE_WIDTHS.thumb)!} alt="" loading="lazy" className="h-7 w-7 rounded bg-white object-contain" />
                            )}
                            {shortModel(partName(c, locale))} ({formatPrice(Number(c.unit_price), locale)})
                          </button>
                        </span>
                      ))}
                  </span>
                )}
              </div>
            )}
            {admin && <Why c={p} />}
          </div>
        ) : m?.have ? (
          <span className="text-[12px] text-heading">{m.have.name}</span>
        ) : m ? (
          // Not in the store: never silently lost, we source it (P5-01).
          <span className="text-[12px] font-medium text-heading">{t("bomWeSource")}</span>
        ) : null}
        {buying && pack > 1 && (
          <span className="mt-1 block text-[10.5px] leading-snug text-inventory">
            {t("packNeed", {
              need: String(l.quantity),
              n: packs ?? 1,
              count: String(packs ?? 1),
              form: arabicCountForm(packs ?? 1),
              pack: String(pack),
            })}
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
          ) : inCart ? (
            <Tag variant="buy">
              <ShoppingCart className="h-3 w-3" />
              {t("bomInCart")}
            </Tag>
          ) : groupOf(l) === "fabrication" ? (
            <Tag variant="neutral">{t("bomFabrication")}</Tag>
          ) : m?.status === "have" ? (
            <Tag variant="inventory">{t("bomHave", { count: m.have!.quantity })}</Tag>
          ) : m?.status === "matched" ? (
            <Tag variant="buy">{l.choice ? t("bomChosen") : t("bomMatched")}</Tag>
          ) : m?.status === "choose" ? (
            m.candidates.every((c) => c.strength === "weak") ? (
              admin ? <Tag variant="neutral">{t("bomWeakOnly")}</Tag> : null
            ) : (
              <Tag variant="neutral">{t("bomChoose")}</Tag>
            )
          ) : m?.status === "not_stocked" && admin ? (
            <Tag variant="neutral">{t("bomNotStocked")}</Tag>
          ) : null}
          {p && !m?.have && !l.fulfilled && <LeadTimeBadge leadClass={p.lead_time_class} />}
          {canBuy && !inCart ? (
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
          ) : !l.fulfilled && groupOf(l) === "fabrication" ? (
            // Made to order: the design-quote path (files, fabrication). Lines we
            // don't stock go in the table's one quote request instead (audit #28).
            <Link
              href="/design/quote"
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

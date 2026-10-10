"use client";

// Step 2 of the client view, "Your parts" (P5-04): photo, name, quantity and
// price for each part we can sell now, ONE total, and ONE button that adds
// exactly those parts. The button's number comes from the same kitPlan() that
// writes the cart rows, so what it says is what is added. Parts we cannot sell
// yet are listed under it in plain words ("We'll source these for you"). No
// match reasons, no SKUs, no model switching; a small "Change" link opens a
// picker of the alternatives (photo, name, price).

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, ShoppingCart, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { GearPlaceholder } from "@/components/parts/gear-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { AlsoUseful } from "@/components/prototyping/also-useful";
import { BigButton, SoftBigButton, textLinkClass } from "@/components/prototyping/client/step-card";
import { track } from "@/lib/analytics";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import type { LineMatch, ProjectLine, ScoredCandidate } from "@/lib/prototyping/bom";
import { humanName } from "@/lib/prototyping/human-name";
import { clientAlternatives } from "@/lib/prototyping/client-steps";
import type { KitLine, KitPlan } from "@/lib/prototyping/kit-plan";
import { arabicCountForm } from "@/lib/text/count";
import { MIN_ALSO_USEFUL } from "@/lib/store/also-useful-relevance";
import type { StoreCardPart } from "@/lib/store/catalog";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import { cn } from "@/lib/utils";

function Photo({ part, size }: { part: ScoredCandidate; size: number }) {
  const img = partImageUrl(part);
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-xl bg-panel shadow-neu-inset"
      style={{ width: size, height: size }}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sizedImage(img, IMAGE_WIDTHS.thumb)!}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <GearPlaceholder className="h-full w-full" />
      )}
    </span>
  );
}

/** The picker behind "Change": the current part and its alternatives, tap one. */
function ChangePicker({
  line,
  current,
  alternatives,
  onPick,
  onClose,
}: {
  line: string;
  current: ScoredCandidate;
  alternatives: ScoredCandidate[];
  onPick: (productId: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("ClientView");
  const locale = useLocale();
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(id: string) {
    setSaving(id);
    await onPick(id);
    setSaving(null);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("changeTitle")}
        onClick={(e) => e.stopPropagation()}
        className="neu flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-b-[1.25rem]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-borderstrong/40 px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-bold text-heading">{t("changeTitle")}</p>
            <p className="truncate text-xs text-mutedtext" dir="auto">
              {line}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-mutedtext hover:text-heading"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="divide-y divide-borderstrong/40 overflow-y-auto px-5">
          {[current, ...alternatives].map((p) => {
            const isCurrent = p.id === current.id;
            return (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <Photo part={p} size={56} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-heading" dir="auto">
                    {partName(p, locale)}
                  </p>
                  <p className="text-sm tabular-nums text-body">{formatPrice(Number(p.unit_price), locale)}</p>
                </div>
                {isCurrent ? (
                  <span className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    {t("changeYours")}
                  </span>
                ) : (
                  <SoftBigButton onClick={() => void pick(p.id)} disabled={saving !== null} className="shrink-0 px-4">
                    {saving === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t("changeUse")}
                  </SoftBigButton>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function ClientParts({
  projectId,
  analysed,
  lines,
  matches,
  plan,
  pricesState,
  needsElectronics,
  onFindElectronics,
  findState,
  onChoose,
  alsoUseful,
  phonePrompt,
}: {
  projectId: string;
  analysed: boolean;
  lines: ProjectLine[];
  matches: Map<string, LineMatch>;
  plan: KitPlan;
  /** "ready" once the first store match is back; never QAR 0.00 before. */
  pricesState: "loading" | "failed" | "ready";
  /** The project needs electronics and none are listed yet. */
  needsElectronics: boolean;
  onFindElectronics: () => void;
  findState: "idle" | "working" | "failed";
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  alsoUseful: StoreCardPart[];
  phonePrompt?: React.ReactNode;
}) {
  const t = useTranslations("ClientView");
  const tP = useTranslations("Prototyping");
  const locale = useLocale();
  const { addKit, kitDiscountPct } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [changing, setChanging] = useState<KitLine | null>(null);

  async function addAll() {
    if (!plan.rows.length) return;
    setAdding(true);
    setFailed(false);
    const kitId = await addKit(
      projectId,
      plan.rows.map((r) => ({ part: r.product, quantity: r.quantity, bomLines: r.bomLines }))
    );
    if (kitId) {
      setAdded(true);
      track("kit_added", { lines: plan.add.length, total_qar: plan.total });
    } else setFailed(true);
    setAdding(false);
  }

  if (!analysed || (lines.length === 0 && !needsElectronics)) {
    return <p className="text-sm text-mutedtext">{t("partsEmpty")}</p>;
  }

  const allInCart = plan.add.length === 0 && plan.inCart.length > 0 && plan.sourced.length === 0;
  const sourcedNames = [...new Set(plan.sourced.map((s) => humanName(s.name)))];

  return (
    <div className="space-y-5">
      {needsElectronics && (
        <div className="space-y-3 rounded-2xl bg-panel/60 p-4 shadow-neu-inset">
          <p className="text-sm text-heading">{t("partsFindElectronicsText")}</p>
          <BigButton onClick={onFindElectronics} disabled={findState === "working"}>
            {findState === "working" && <Loader2 className="h-4 w-4 animate-spin" />}
            {findState === "working" ? t("partsFinding") : t("partsFindElectronics")}
          </BigButton>
          {findState === "failed" && <p className="text-sm text-destructive">{t("partsFindFailed")}</p>}
        </div>
      )}

      {lines.length > 0 && pricesState === "loading" && (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t("partsLoading")}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && pricesState === "failed" && <p className="text-sm text-destructive">{t("partsPricesFailed")}</p>}

      {pricesState === "ready" && plan.add.length > 0 && (
        <ul className="divide-y divide-borderstrong/40">
          {plan.add.map((k) => {
            const m = matches.get(k.lineId);
            const alts = clientAlternatives(m?.candidates ?? [], k.product.id);
            return (
              <li key={k.lineId} className="flex items-center gap-3 py-3">
                <Photo part={k.product} size={64} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-heading" dir="auto">
                    {partName(k.product, locale)}
                  </p>
                  <p className="text-xs text-mutedtext">
                    {t("partsQty", { n: String(k.packs) })}
                    {k.packSize > 1 ? ` · ${t("partsPack", { n: String(k.packSize) })}` : ""}
                  </p>
                  {alts.length > 0 && (
                    <button type="button" onClick={() => setChanging(k)} className={cn(textLinkClass, "-ms-1 text-xs")}>
                      {t("partsChange")}
                    </button>
                  )}
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-heading">{formatPrice(k.lineTotal, locale)}</p>
              </li>
            );
          })}
        </ul>
      )}

      {pricesState === "ready" && plan.add.length > 0 && (
        <div className="space-y-3 border-t border-borderstrong/40 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-heading">{t("partsTotal")}</p>
            <p className="text-xl font-extrabold tabular-nums text-heading">{formatPrice(plan.total, locale)}</p>
          </div>
          {kitDiscountPct > 0 && <p className="text-xs text-emerald-700">{t("partsDiscountIncluded")}</p>}
          {added ? (
            <Link href="/store/cart" className={cn(textLinkClass, "text-emerald-700")}>
              <Check className="h-4 w-4" />
              {t("partsAdded")} · {t("partsViewCart")}
            </Link>
          ) : (
            <BigButton onClick={() => void addAll()} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              {t("addAll", { total: formatPrice(plan.total, locale) })}
            </BigButton>
          )}
          {failed && <p className="text-sm text-destructive">{t("addFailed")}</p>}
          {plan.inCart.length > 0 && !added && (
            <p className="text-xs text-mutedtext">
              {tP("kitAlreadyInCart", {
                n: plan.inCart.length,
                count: String(plan.inCart.length),
                form: arabicCountForm(plan.inCart.length),
              })}
            </p>
          )}
        </div>
      )}

      {pricesState === "ready" && allInCart && (
        <Link href="/store/cart" className={cn(textLinkClass, "text-emerald-700")}>
          <Check className="h-4 w-4" />
          {t("partsAllInCart")} · {t("partsViewCart")}
        </Link>
      )}

      {pricesState === "ready" && sourcedNames.length > 0 && (
        <p className="text-sm leading-relaxed text-mutedtext">
          <span className="font-semibold text-heading">{t("partsWeSource")}</span> {sourcedNames.join(" · ")}
        </p>
      )}

      {phonePrompt}

      {pricesState === "ready" && alsoUseful.length >= MIN_ALSO_USEFUL && <AlsoUseful parts={alsoUseful} />}

      {changing && (
        <ChangePicker
          line={humanName(changing.name)}
          current={changing.product}
          alternatives={clientAlternatives(matches.get(changing.lineId)?.candidates ?? [], changing.product.id)}
          onPick={(productId) => onChoose(changing.lineId, productId)}
          onClose={() => setChanging(null)}
        />
      )}
    </div>
  );
}

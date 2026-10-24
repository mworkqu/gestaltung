"use client";

// Step 2 · Your parts. On first entry the parts are picked automatically
// (POST /api/studio/pick, free, skeleton while it runs). A PICTURE of the parts
// on their plate (drawn in the geometry worker — no 3D engine on the page before
// "Create my CAD", owner 2026-10-11) with a tap target on every part; while it
// is drawn (or where the browser cannot draw off screen) the part photos / icons
// show instead. Tap a part (on the picture, the grid or the list) to see its
// name and what it does. Each row: store photo + price when we sell it (else a neat icon tile
// and "We'll source this"), one plain "why" line, Swap and Remove. "Add a
// part" opens the library by category (helper parts hidden). ONE main
// button: Next. "Add all to cart" is a quiet secondary action.
//
// Pieces: parts/PartTile, parts/PartChoices, parts/PartsPicturePane (also used by
// the Make step), parts/use-parts-actions.

import { arabicCountForm } from "@/lib/text/count";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, Repeat2, ShoppingCart, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatPrice, partName } from "@/lib/parts/format";
import type { StoreCardPart } from "@/lib/store/catalog";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { CATEGORIES, type Category, type StudioComponent, type StudioDoc } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../studio-ctx";
import { Bar, linkCls, MainButton, Problem, Sheet, StepFrame } from "../ui";
import { linePrice, orderQty, productFor, storeLines, useAddAllToCart } from "../use-studio-cart";
import { packSizeOf } from "@/lib/store/pack";
import { colourName } from "@/lib/studio/variants";
import { groupComponents, groupHas, withQuantity } from "@/lib/studio/parts-group";
import { usePickProgress } from "../use-pick-progress";
import { PICK_STAGES } from "@/lib/studio/client/progress";
import { PartTile, PartPopover } from "./parts/PartTile";
import { PartChoices } from "./parts/PartChoices";
import { PartsPicturePane } from "./parts/PartsPicturePane";
import { usePartsActions } from "./parts/use-parts-actions";

// Moved to ./parts (R8); re-exported so existing imports keep working.
export { CATEGORY_ICON } from "./parts/PartTile";
export { PartsPicturePane } from "./parts/PartsPicturePane";

const accent = STEP_ACCENT.parts;

export function PartsStep({
  ctx,
  doc,
  products,
  productsLoading,
  beforeServer,
  onComponents,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  products: Map<string, StoreCardPart>;
  productsLoading: boolean;
  beforeServer: () => Promise<void>;
  onComponents: (components: StudioComponent[], serverVersion: number | null, edited: boolean) => void;
  onNext: () => void;
}) {
  const { getPart, partsByCategory } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const [selected, setSelected] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<StudioComponent | null>(null);
  const [adding, setAdding] = useState(false);
  const [addCat, setAddCat] = useState<Category>("sensor");
  const [popFor, setPopFor] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cart = useAddAllToCart(ctx.api.mode === "live" ? ctx.projectId : null);
  const { busy, problem, pick, edit, swap, add } = usePartsActions({
    ctx,
    doc,
    beforeServer,
    onComponents,
    onSwapped: () => setSwapFor(null),
    onAdded: () => setAdding(false),
  });

  // Popover closes on Esc and on a press outside the list.
  useEffect(() => {
    if (!popFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopFor(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node)) setPopFor(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [popFor]);

  const { lines, total } = storeLines(doc.components, products, getPart);
  const groups = groupComponents(doc.components);
  // Parts with no store price ("We'll source this"): never silently left out of the total.
  const onRequest = productsLoading ? 0 : groups.filter((g) => !productFor(g.partId, products, getPart, g.variant)).length;
  const sel = doc.components.find((c) => c.instanceId === selected);
  const selPart = sel ? getPart(sel.partId) : undefined;
  const loading = busy && doc.components.length === 0;
  const step = usePickProgress(loading);
  const addableCats = CATEGORIES.filter((c) => partsByCategory(c).length > 0);

  return (
    <StepFrame
      step="parts"
      n={ctx.n("parts")}
      title={t("title_parts")}
      headline={t("headline_parts")}
      intro={t("intro_parts")}
      footer={
        <MainButton onClick={onNext} disabled={doc.components.length === 0}>
          {t("next")}
        </MainButton>
      }
      secondary={
        lines.length > 0 ? (
          cart.state === "added" ? (
            <Link href="/store/cart" className={linkCls}>
              <Check className="h-4 w-4" aria-hidden /> {t("viewCart")}
            </Link>
          ) : (
            <button type="button" className={linkCls} onClick={() => void cart.addAll(lines)} disabled={cart.state === "adding"}>
              <ShoppingCart className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {cart.state === "adding" ? t("addingToCart") : t("addAllToCart")}
            </button>
          )
        ) : null
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div
            className="relative h-[280px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[360px]"
            data-testid="studio-parts-viewer"
          >
            <PartsPicturePane
              components={doc.components}
              products={products}
              selected={selected}
              onSelect={setSelected}
              picking={loading}
              locale={locale}
            />
          </div>
          {sel && selPart && (
            <div className="tile flex items-start gap-3 border-0 p-4 motion-safe:animate-rise" style={{ background: accent.soft }} aria-live="polite">
              <PartTile part={selPart} product={productFor(sel.partId, products, getPart, sel.variant)} size={44} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-heading">{selPart.name[locale]}</p>
                <p className="text-sm text-body">{selPart.blurb[locale]}</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="space-y-3" role="status" aria-busy="true">
              <span className="sr-only">{t("partsLoading")}</span>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="tile flex items-center gap-3 p-3">
                  <Bar className="h-14 w-14 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Bar className="h-4 w-1/2" />
                    <Bar className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
              <p className="text-sm font-medium" style={{ color: accent.ink }} data-testid="studio-parts-progress" data-step={step}>
                {t("partsProgress", { n: step, total: PICK_STAGES })}
                <span className="block text-[13px] font-normal text-body">{t(`partsStage_${step}`)}</span>
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="space-y-2.5" data-testid="studio-parts-list">
              {groups.map((g) => {
                const c = g.first;
                const part = getPart(c.partId);
                const product = productFor(c.partId, products, getPart, g.variant);
                const isSel = groupHas(g, selected);
                const colour = colourName(g.variant, locale);
                const baseName = product ? partName(product, locale) : `${colour ? `${colour} · ` : ""}${part?.name[locale] ?? c.label}`;
                // A pack listing ("(5 Pack)") never gets "× 3" on its name: the line says "Need 3 · 1 pack of 5".
                const pack = product ? packSizeOf(product) : 1;
                const rowName = pack > 1 ? baseName : withQuantity(baseName, g.quantity);
                const packs = product ? orderQty(product, g.quantity) : 0;
                return (
                  <li
                    key={g.key}
                    className={cn(
                      "tile relative flex scroll-mt-44 items-start gap-3 p-3 transition-[box-shadow,border-color] motion-safe:transition-[box-shadow,border-color,transform]",
                      "hover:ring-1 motion-safe:hover:-translate-y-0.5 hover:shadow-neu",
                      isSel && "ring-2 shadow-neu motion-safe:-translate-y-0.5",
                      popFor === c.instanceId && "z-20",
                    )}
                    style={{ "--tw-ring-color": accent.base } as React.CSSProperties}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setPopFor(c.instanceId)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && setPopFor((p) => (p === c.instanceId ? null : p))}
                    data-testid="studio-part-row"
                    data-part={c.partId}
                    data-quantity={g.quantity}
                    data-selected={isSel ? "true" : undefined}
                  >
                    <button
                      type="button"
                      onClick={(e) =>
                        // Mouse: hover already opened it, keep it. Tap / keyboard: toggle.
                        (e.nativeEvent as PointerEvent).pointerType === "mouse"
                          ? setPopFor(c.instanceId)
                          : setPopFor(popFor === c.instanceId ? null : c.instanceId)
                      }
                      className="shrink-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2"
                      style={{ "--tw-ring-color": accent.base } as React.CSSProperties}
                      aria-expanded={popFor === c.instanceId}
                      aria-controls={`part-pop-${c.instanceId}`}
                      aria-label={t("partsPopover.open", { name: part?.name[locale] ?? c.label })}
                      data-testid="studio-part-info"
                    >
                      <PartTile part={part} product={product} />
                    </button>
                    {popFor === c.instanceId && (
                      <PartPopover
                        id={`part-pop-${c.instanceId}`}
                        part={part}
                        product={product}
                        name={rowName}
                        purpose={c.reason || part?.blurb[locale] || ""}
                        locale={locale}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(isSel ? null : c.instanceId)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-start"
                      aria-pressed={isSel}
                    >
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-sm font-bold text-heading" data-testid="studio-part-name">
                          {rowName}
                        </span>
                        <span className="block text-[13px] leading-snug text-body">{c.reason || part?.blurb[locale]}</span>
                        <span className="block text-[13px] font-semibold" style={{ color: product ? accent.ink : undefined }}>
                          {product ? (
                            <>
                              {pack > 1 && (
                                <span className="font-medium text-body" data-testid="studio-part-packs">
                                  {t("partNeedPacks", {
                                    need: String(g.quantity),
                                    count: String(packs),
                                    form: arabicCountForm(packs),
                                    size: String(pack),
                                  })}
                                  {" · "}
                                </span>
                              )}
                              {formatPrice(linePrice(product, g.quantity), locale)}
                              {c.auto && <span className="font-medium text-mutedtext">{` · ${t("addedForYou")}`}</span>}
                            </>
                          ) : productsLoading ? (
                            <Bar className="mt-1 h-3 w-16" />
                          ) : (
                            // Every line: a price, or "We'll source this" (priced on request, counted in the total line).
                            <span className="text-mutedtext" data-testid="studio-part-on-request">
                              {c.auto ? `${t("addedForYou")} · ${t("sourceIt")}` : t("sourceIt")}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {!c.auto && (
                      <span className="flex shrink-0 flex-col items-end">
                        <button type="button" className={cn(linkCls, "text-[13px]")} onClick={() => setSwapFor(c)}>
                          <Repeat2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                          {t("swap")}
                        </button>
                        {part?.category !== "mcu" && (
                          <button
                            type="button"
                            className={cn(linkCls, "text-[13px] text-mutedtext hover:text-destructive")}
                            // One at a time: "Servo × 3" → "Servo × 2".
                            onClick={() => edit(doc.components.filter((x) => x.instanceId !== g.items[g.items.length - 1].instanceId))}
                            aria-label={`${t("remove")} ${part?.name[locale] ?? c.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                            {t("remove")}
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && doc.components.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <button type="button" className={linkCls} onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {t("addPart")}
              </button>
              {(lines.length > 0 || onRequest > 0) && (
                <p className="text-sm text-body" data-testid="studio-parts-total" data-on-request={onRequest}>
                  {lines.length > 0 && (
                    <>
                      {t("partsTotal")} <span className="font-bold tabular-nums text-heading">{formatPrice(total, locale)}</span>
                    </>
                  )}
                  {onRequest > 0 && (
                    <span className="text-mutedtext">
                      {lines.length > 0 ? " " : ""}
                      {t(lines.length > 0 ? "partsOnRequestPlus" : "partsOnRequestOnly", { count: String(onRequest), form: arabicCountForm(onRequest) })}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
          {cart.state === "failed" && <Problem>{t("cartFailed")}</Problem>}
          {problem && (
            <div className="space-y-2">
              <Problem>{problem}</Problem>
              <button type="button" className={linkCls} onClick={() => void pick()} disabled={busy}>
                {t("tryAgain")}
              </button>
            </div>
          )}
        </div>
      </div>

      <Sheet
        open={swapFor !== null}
        title={swapFor ? t("swapTitle", { name: getPart(swapFor.partId)?.name[locale] ?? swapFor.label }) : ""}
        onClose={() => setSwapFor(null)}
      >
        {swapFor && (
          <PartChoices
            parts={partsByCategory(getPart(swapFor.partId)?.category ?? "sensor").filter((p) => p.id !== swapFor.partId)}
            products={products}
            locale={locale}
            empty={t("noOthers")}
            onPick={(p) => swap(swapFor, p)}
          />
        )}
      </Sheet>

      <Sheet open={adding} title={t("addTitle")} onClose={() => setAdding(false)}>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
          {addableCats.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={addCat === c}
              onClick={() => setAddCat(c)}
              className={cn(
                "min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                addCat === c ? "text-white" : "bg-panel text-heading",
              )}
              style={addCat === c ? { background: accent.ink } : undefined}
            >
              {t(`cat_${c}`)}
            </button>
          ))}
        </div>
        <PartChoices parts={partsByCategory(addCat)} products={products} locale={locale} empty={t("noOthers")} onPick={add} />
      </Sheet>
    </StepFrame>
  );
}

"use client";

// Step 2 · Your parts. On first entry the parts are picked automatically
// (POST /api/studio/pick, free, skeleton while it runs). The parts float on a
// plate in 3D; tap one (in 3D or in the list) to see its name and what it
// does. Each row: store photo + price when we sell it (else a neat icon tile
// and "We'll source this"), one plain "why" line, Swap and Remove. "Add a
// part" opens the library by category (helper parts hidden). ONE main
// button: Next. "Add all to cart" is a quiet secondary action.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BatteryCharging,
  Check,
  Cpu,
  Lightbulb,
  Monitor,
  Plug,
  Plus,
  Radar,
  Repeat2,
  Settings2,
  ShoppingCart,
  ToggleLeft,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { StudioViewer } from "@/components/studio/viewer/ViewerLazy";
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import type { StoreCardPart } from "@/lib/store/catalog";
import { getPart, partsByCategory } from "@/lib/studio/library";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { CATEGORIES, type Category, type LibraryPart, type StudioComponent, type StudioDoc } from "@/lib/studio/schema";
import { nextInstanceId } from "@/lib/studio/client/steps";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, Sheet, StepFrame } from "../ui";
import { productFor, storeLines, useAddAllToCart } from "../use-studio-cart";
import { problemKey } from "./problem";

const accent = STEP_ACCENT.parts;

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  mcu: Cpu,
  power: BatteryCharging,
  sensor: Radar,
  display: Monitor,
  input: ToggleLeft,
  output: Lightbulb,
  actuator: Settings2,
  connector: Plug,
};

function PartTile({ part, product, size = 56 }: { part: LibraryPart | undefined; product: StoreCardPart | null; size?: number }) {
  const img = product ? partImageUrl(product) : null;
  const Icon = part ? CATEGORY_ICON[part.category] : Cpu;
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-2xl shadow-neu-inset"
      style={{ width: size, height: size, background: img ? "#fff" : accent.soft }}
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
        <Icon className="h-6 w-6" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

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
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<StudioComponent | null>(null);
  const [adding, setAdding] = useState(false);
  const [addCat, setAddCat] = useState<Category>("sensor");
  const started = useRef(false);
  const cart = useAddAllToCart(ctx.api.mode === "live" ? ctx.projectId : null);

  async function pick() {
    setBusy(true);
    setProblem(null);
    await beforeServer();
    const r = await ctx.api.pick(doc.spec, locale);
    setBusy(false);
    if (!r.ok) {
      setProblem(t(problemKey(r)));
      return;
    }
    onComponents(r.data.components, r.data.docVersion, false);
  }

  useEffect(() => {
    if (started.current || doc.components.length > 0) return;
    started.current = true;
    void pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on entry
  }, []);

  const edit = (next: StudioComponent[]) => onComponents(next.filter((c) => !c.auto), null, true);

  function swap(target: StudioComponent, part: LibraryPart) {
    edit(
      doc.components.map((c) =>
        c.instanceId === target.instanceId
          ? { partId: part.id, instanceId: nextInstanceId(part.id, doc.components), label: part.name[locale], reason: part.blurb[locale] }
          : c,
      ),
    );
    setSwapFor(null);
  }

  function add(part: LibraryPart) {
    edit([
      ...doc.components,
      { partId: part.id, instanceId: nextInstanceId(part.id, doc.components), label: part.name[locale], reason: part.blurb[locale] },
    ]);
    setAdding(false);
  }

  const viewerComponents = useMemo(
    () => doc.components.filter((c) => getPart(c.partId)).map((c) => ({ instanceId: c.instanceId, partId: c.partId, label: c.label })),
    [doc.components],
  );
  const { lines, total } = storeLines(doc.components, products);
  const sel = doc.components.find((c) => c.instanceId === selected);
  const selPart = sel ? getPart(sel.partId) : undefined;
  const loading = busy && doc.components.length === 0;
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
            {loading ? (
              <div className="h-full w-full motion-safe:animate-pulse" style={{ background: "linear-gradient(180deg,#f4f7fb,#e6ebf2)" }} />
            ) : (
              <StudioViewer
                components={viewerComponents}
                selected={selected}
                onSelect={setSelected}
                accent={accent.base}
                ariaLabel={t("viewerParts")}
              />
            )}
          </div>
          {sel && selPart && (
            <div className="tile flex items-start gap-3 border-0 p-4 motion-safe:animate-rise" style={{ background: accent.soft }} aria-live="polite">
              <PartTile part={selPart} product={productFor(sel.partId, products)} size={44} />
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
              <p className="text-sm font-medium" style={{ color: accent.ink }}>
                {t("partsLoading")}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5" data-testid="studio-parts-list">
              {doc.components.map((c) => {
                const part = getPart(c.partId);
                const product = productFor(c.partId, products);
                const isSel = selected === c.instanceId;
                return (
                  <li
                    key={c.instanceId}
                    className={cn("tile flex items-start gap-3 p-3 transition-[box-shadow,border-color]", isSel && "ring-2")}
                    style={isSel ? ({ "--tw-ring-color": accent.base } as React.CSSProperties) : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(isSel ? null : c.instanceId)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-start"
                      aria-pressed={isSel}
                    >
                      <PartTile part={part} product={product} />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-sm font-bold text-heading">
                          {product ? partName(product, locale) : part?.name[locale] ?? c.label}
                        </span>
                        <span className="block text-[13px] leading-snug text-body">{c.reason || part?.blurb[locale]}</span>
                        <span className="block text-[13px] font-semibold" style={{ color: product ? accent.ink : undefined }}>
                          {product ? (
                            formatPrice(Number(product.unit_price ?? 0) * Math.max(1, product.min_order_qty ?? 1), locale)
                          ) : productsLoading ? (
                            <Bar className="mt-1 h-3 w-16" />
                          ) : (
                            <span className="text-mutedtext">{c.auto ? t("addedForYou") : t("sourceIt")}</span>
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
                            onClick={() => edit(doc.components.filter((x) => x.instanceId !== c.instanceId))}
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
              {lines.length > 0 && (
                <p className="text-sm text-body">
                  {t("partsTotal")} <span className="font-bold tabular-nums text-heading">{formatPrice(total, locale)}</span>
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

function PartChoices({
  parts,
  products,
  locale,
  empty,
  onPick,
}: {
  parts: LibraryPart[];
  products: Map<string, StoreCardPart>;
  locale: "en" | "ar";
  empty: string;
  onPick: (p: LibraryPart) => void;
}) {
  if (!parts.length) return <p className="text-sm text-mutedtext">{empty}</p>;
  return (
    <ul className="space-y-2">
      {parts.map((p) => {
        const product = productFor(p.id, products);
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="tile flex w-full items-center gap-3 p-3 text-start transition-colors hover:bg-white"
            >
              <PartTile part={p} product={product} size={48} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-heading">{p.name[locale]}</span>
                <span className="block text-[13px] text-body">{p.blurb[locale]}</span>
              </span>
              {product && (
                <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: accent.ink }}>
                  {formatPrice(Number(product.unit_price ?? 0), locale)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

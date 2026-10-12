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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { formatPrice, partImageUrl, partName } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import type { StoreCardPart } from "@/lib/store/catalog";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { popoverPhoto, stockLine } from "@/lib/studio/part-photo";
import { CATEGORIES, type Category, type LibraryPart, type StudioComponent, type StudioDoc } from "@/lib/studio/schema";
import { nextInstanceId } from "@/lib/studio/client/steps";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, Sheet, StepFrame } from "../ui";
import { productFor, storeLines, useAddAllToCart } from "../use-studio-cart";
import { usePickProgress } from "../use-pick-progress";
import { PICK_STAGES } from "@/lib/studio/client/progress";
import { problemKey } from "./problem";
import { StudioLoader } from "../StudioLoader";
import { partsPictureSupported, partsSpin, spreadSpots, type PartsSpin, type PartsSpinHandle } from "@/lib/studio/client/parts-picture";
import { PartsFlipbook } from "./PartsFlipbook";

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

/** Hover (mouse) / tap / keyboard popover: store photo (else the icon), name, purpose, price, stock. */
function PartPopover({
  id,
  part,
  product,
  name,
  purpose,
  locale,
}: {
  id: string;
  part: LibraryPart | undefined;
  product: StoreCardPart | null;
  name: string;
  purpose: string;
  locale: "en" | "ar";
}) {
  const t = useTranslations("Studio.partsPopover");
  const photo = popoverPhoto(product as Parameters<typeof popoverPhoto>[0], 280);
  const Icon = part ? CATEGORY_ICON[part.category] : Cpu;
  const stock = stockLine(product);
  const price = product ? formatPrice(Number(product.unit_price ?? 0) * Math.max(1, product.min_order_qty ?? 1), locale) : null;
  return (
    <div
      id={id}
      role="group"
      aria-label={name}
      className="tile absolute start-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-3rem))] space-y-2 p-3 text-start shadow-neu motion-safe:animate-rise"
    >
      <div className="grid h-36 place-items-center overflow-hidden rounded-xl" style={{ background: photo ? "#fff" : accent.soft }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={280} height={144} loading="lazy" decoding="async" className="h-full w-full object-contain" />
        ) : (
          <Icon className="h-12 w-12" style={{ color: accent.ink }} strokeWidth={1.25} aria-hidden />
        )}
      </div>
      <p className="text-sm font-bold text-heading">{name}</p>
      {purpose && <p className="text-[13px] leading-snug text-body">{purpose}</p>}
      <p className="text-[13px] font-semibold" style={{ color: accent.ink }}>
        {price ?? <span className="text-mutedtext">{t("noPrice")}</span>}
      </p>
      <p className="flex items-center gap-1.5 text-[13px] text-body">
        <span
          className={cn("inline-block h-2 w-2 shrink-0 rounded-full", stock.kind === "in_stock" ? "bg-emerald-500" : "bg-amber-400")}
          aria-hidden
        />
        {stock.kind === "in_stock"
          ? t("inStock")
          : stock.cls
            ? t("sourceTime", { time: t(`time_${stock.cls}`) })
            : t("sourceNoTime")}
      </p>
    </div>
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
  const { getPart, partsByCategory } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<StudioComponent | null>(null);
  const [adding, setAdding] = useState(false);
  const [addCat, setAddCat] = useState<Category>("sensor");
  const [popFor, setPopFor] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
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

  const { lines, total } = storeLines(doc.components, products, getPart);
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
              <PartTile part={selPart} product={productFor(sel.partId, products, getPart)} size={44} />
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
              {doc.components.map((c) => {
                const part = getPart(c.partId);
                const product = productFor(c.partId, products, getPart);
                const isSel = selected === c.instanceId;
                return (
                  <li
                    key={c.instanceId}
                    className={cn(
                      "tile relative flex items-start gap-3 p-3 transition-[box-shadow,border-color] motion-safe:transition-[box-shadow,border-color,transform]",
                      "hover:ring-1 motion-safe:hover:-translate-y-0.5 hover:shadow-neu",
                      isSel && "ring-2 shadow-neu motion-safe:-translate-y-0.5",
                      popFor === c.instanceId && "z-20",
                    )}
                    style={{ "--tw-ring-color": accent.base } as React.CSSProperties}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setPopFor(c.instanceId)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && setPopFor((p) => (p === c.instanceId ? null : p))}
                    data-testid="studio-part-row"
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
                        name={product ? partName(product, locale) : part?.name[locale] ?? c.label}
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
  const { getPart } = useStudioLibrary();
  if (!parts.length) return <p className="text-sm text-mutedtext">{empty}</p>;
  return (
    <ul className="space-y-2">
      {parts.map((p) => {
        const product = productFor(p.id, products, getPart);
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

/** Box size in device pixels, in 40 px steps (a resize does not redraw for every pixel). */
function usePictureSize(ref: React.RefObject<HTMLDivElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const step = (n: number) => Math.max(80, Math.round((n * dpr) / 40) * 40);
      const w = step(el.clientWidth);
      const h = step(el.clientHeight);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The Parts step picture: the worker's PNG of the plate with a tap target on every
 * part; the photo / icon grid while it is drawn, and in its place where the browser
 * cannot draw off screen or the drawing failed.
 */
export function PartsPicturePane({
  components,
  products,
  selected,
  onSelect,
  picking,
  locale,
  onPicture,
}: {
  components: StudioComponent[];
  products: Map<string, StoreCardPart>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  picking: boolean;
  locale: "en" | "ar";
  /** The picture's URL once drawn (null while there is none), e.g. for "Share picture". */
  onPicture?: (url: string | null) => void;
}) {
  const t = useTranslations("Studio");
  const { getPart } = useStudioLibrary();
  const box = useRef<HTMLDivElement>(null);
  const size = usePictureSize(box);
  const [supported] = useState(() => partsPictureSupported());
  const shown = useMemo(
    () =>
      components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ c, part }] : [];
      }),
    [components, getPart],
  );
  const pairs = useMemo(() => shown.map(({ c, part }) => [c.instanceId, part] as [string, LibraryPart]), [shown]);
  // The turntable of this parts list: frame 0 first, the others stream in after it.
  const [pic, setPic] = useState<{ key: string; handle: PartsSpinHandle } | null>(null);
  const [spin, setSpin] = useState<{ key: string; value: PartsSpin } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = size && pairs.length ? `${pairs.map(([id, p]) => `${id}:${p.id}`).join("|")}#${size.w}x${size.h}` : "";

  useEffect(() => {
    if (!supported || !key || !size) return;
    let alive = true;
    const handle = partsSpin(pairs, size.w, size.h, accent.base);
    const unsub = handle.subscribe(() => {
      if (alive) setSpin({ key, value: handle.get() });
    });
    handle.first.then(
      (value) => {
        if (!alive) return;
        setPic({ key, handle });
        setSpin({ key, value: handle.get() });
        void value;
      },
      () => {
        if (alive) setFailed(key);
      },
    );
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the parts + size
  }, [key, supported]);

  // A new list keeps the last picture on screen (dimmed) until the new one is drawn.
  const current = supported ? (spin?.value ?? null) : null;
  const drawing = supported && !!key && pic?.key !== key && failed !== key;
  const gridOnly = !current || !current.frames[0] || (failed === key && pic?.key !== key);
  const readyUrl = !gridOnly && !drawing && current ? (current.frames[0]?.url ?? null) : null;
  // More frames are still coming (frame 0 is already on screen).
  const streaming = !gridOnly && !drawing && !!current && !current.done && !current.failed;
  useEffect(() => {
    onPicture?.(readyUrl);
  }, [onPicture, readyUrl]);
  const nameOf = (c: StudioComponent, part: LibraryPart) => {
    const product = productFor(c.partId, products, getPart);
    return product ? partName(product, locale) : part.name[locale];
  };

  return (
    <div
      ref={box}
      className="absolute inset-0"
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}
      data-spin-frames={current?.total ?? 0}
      data-spin-bytes={current?.bytes ?? 0}
      data-spin-ms={current?.ms ?? 0}
      data-spin-first-ms={current?.firstMs ?? 0}
      data-picture={picking ? "picking" : !gridOnly ? (drawing ? "redrawing" : streaming ? "streaming" : "ready") : drawing ? "drawing" : "grid"}
    >
      {picking ? (
        <StudioLoader label={t("loader.parts")} accent={accent.base} ink={accent.ink} status={false} className="h-full" />
      ) : !gridOnly && current ? (
        <>
          <PartsFlipbook
            frames={current.frames.map((f) => f?.url)}
            total={current.total}
            width={current.width}
            height={current.height}
            alt={t("loader.partsAlt")}
            hold={selected !== null}
            dim={drawing}
          >
            {({ frame, spinning }) =>
              !drawing && !spinning ? (
                <PartsSpots
                  spots={current.frames[frame]?.spots ?? current.frames[0]?.spots ?? []}
                  boxRef={box}
                  size={size}
                  frame={frame}
                  shown={shown}
                  selected={selected}
                  onSelect={onSelect}
                  nameOf={nameOf}
                  accent={accent}
                />
              ) : null
            }
          </PartsFlipbook>
          {(drawing || streaming) && (
            <div className="pointer-events-none absolute end-3 top-3 rounded-2xl bg-white/85 backdrop-blur">
              <StudioLoader label={t("loader.parts")} accent={accent.base} ink={accent.ink} className="p-2" />
            </div>
          )}
        </>
      ) : (
        <div className="relative h-full overflow-y-auto p-4" data-testid="studio-parts-grid">
          <ul className={cn("grid grid-cols-3 content-center gap-3 sm:grid-cols-4", drawing && "opacity-50")} aria-label={t("loader.partsGrid")}>
            {shown.map(({ c, part }) => {
              const on = selected === c.instanceId;
              return (
                <li key={c.instanceId}>
                  <button
                    type="button"
                    onClick={() => onSelect(on ? null : c.instanceId)}
                    aria-pressed={on}
                    className={cn("flex w-full flex-col items-center gap-1.5 rounded-2xl p-1.5 text-center", on && "ring-2")}
                    style={{ "--tw-ring-color": accent.base } as React.CSSProperties}
                  >
                    <PartTile part={part} product={productFor(c.partId, products, getPart)} size={56} />
                    <span className="line-clamp-2 text-xs font-semibold leading-tight text-heading">{nameOf(c, part)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {drawing && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="rounded-2xl bg-white/85 backdrop-blur">
                <StudioLoader label={t("loader.parts")} accent={accent.base} ink={accent.ink} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The tap dots for the frame on screen (they only exist while the parts are not turning). */
function PartsSpots({
  spots,
  boxRef,
  size,
  frame,
  shown,
  selected,
  onSelect,
  nameOf,
  accent: acc,
}: {
  spots: { instanceId: string; x: number; y: number }[];
  boxRef: React.RefObject<HTMLDivElement | null>;
  size: { w: number; h: number } | null;
  frame: number;
  shown: { c: StudioComponent; part: LibraryPart }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  nameOf: (c: StudioComponent, part: LibraryPart) => string;
  accent: { base: string; ink: string };
}) {
  // Tap targets at least 44 px apart (small parts side by side would hide each other).
  const spread = useMemo(() => {
    const el = boxRef.current;
    return spreadSpots(spots, el?.clientWidth ?? 0, el?.clientHeight ?? 0, 44);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-spread per frame and when the box size changes
  }, [spots, size, frame]);
  return (
    <>
      {spread.map((spot) => {
        const item = shown.find((x) => x.c.instanceId === spot.instanceId);
        if (!item) return null;
        const on = selected === spot.instanceId;
        return (
          <button
            key={spot.instanceId}
            type="button"
            onClick={() => onSelect(on ? null : spot.instanceId)}
            aria-pressed={on}
            aria-label={nameOf(item.c, item.part)}
            // The picture is not mirrored in Arabic: its coordinates are physical.
            style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
            className="group absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-none"
            data-testid="studio-parts-spot"
          >
            <span
              className={cn(
                "block rounded-full border-2 border-white shadow-neu-sm transition-[width,height,opacity]",
                on ? "h-5 w-5" : "h-3.5 w-3.5 opacity-80 group-hover:h-5 group-hover:w-5 group-hover:opacity-100 group-focus-visible:h-5 group-focus-visible:w-5",
              )}
              style={{ background: on ? acc.ink : acc.base }}
            />
          </button>
        );
      })}
    </>
  );
}

"use client";

// The Parts step picture (also on the Make step), split out of PartsStep (R8).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { partName } from "@/lib/parts/format";
import type { StoreCardPart } from "@/lib/store/catalog";
import { useStudioLibrary } from "../../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { LibraryPart, StudioComponent } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import { productFor } from "../../use-studio-cart";
import { colourName, styledPart } from "@/lib/studio/variants";
import { groupComponents, groupHas, withQuantity } from "@/lib/studio/parts-group";
import { StudioLoader } from "../../StudioLoader";
import {
  partsPictureSupported,
  partsSpin,
  spreadSpots,
  type PartsSpin,
  type PartsSpinHandle,
} from "@/lib/studio/client/parts-picture";
import { PartsFlipbook } from "../PartsFlipbook";
import { PartTile } from "./PartTile";

const accent = STEP_ACCENT.parts;

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
        // Coloured parts are drawn in their colour (a green LED is green on the plate).
        return part ? [{ c, part: styledPart(part, c.variant) }] : [];
      }),
    [components, getPart],
  );
  const pairs = useMemo(() => shown.map(({ c, part }) => [c.instanceId, part] as [string, LibraryPart]), [shown]);
  // The photo / icon grid shows identical parts once, with "× n" (the picture shows every one).
  const tiles = useMemo(
    () =>
      groupComponents(components).flatMap((g) => {
        const part = getPart(g.partId);
        return part ? [{ g, part }] : [];
      }),
    [components, getPart],
  );
  // The turntable of this parts list: frame 0 first, the others stream in after it.
  const [pic, setPic] = useState<{ key: string; handle: PartsSpinHandle } | null>(null);
  const [spin, setSpin] = useState<{ key: string; value: PartsSpin } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key =
    size && pairs.length
      ? `${shown.map(({ c, part }) => `${c.instanceId}:${part.id}:${c.variant ?? ""}`).join("|")}#${size.w}x${size.h}`
      : "";

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

  // Only a picture of THIS parts list is shown (owner 2026-10-18: an older plate with other
  // parts on it was left on screen); while a new list is drawn, the grid shows exactly the list.
  const current = supported && spin?.key === key ? spin.value : null;
  const drawing = supported && !!key && pic?.key !== key && failed !== key;
  const gridOnly = !current || !current.frames[0] || (failed === key && pic?.key !== key);
  const readyUrl = !gridOnly && !drawing && current ? (current.frames[0]?.url ?? null) : null;
  // More frames are still coming (frame 0 is already on screen).
  const streaming = !gridOnly && !drawing && !!current && !current.done && !current.failed;
  useEffect(() => {
    onPicture?.(readyUrl);
  }, [onPicture, readyUrl]);
  const nameOf = (c: StudioComponent, part: LibraryPart) => {
    const product = productFor(c.partId, products, getPart, c.variant);
    const colour = colourName(c.variant, locale);
    return product ? partName(product, locale) : `${colour ? `${colour} · ` : ""}${part.name[locale]}`;
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
            {tiles.map(({ g, part }) => {
              const c = g.first;
              const on = groupHas(g, selected);
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(on ? null : c.instanceId)}
                    aria-pressed={on}
                    className={cn("flex w-full flex-col items-center gap-1.5 rounded-2xl p-1.5 text-center", on && "ring-2")}
                    style={{ "--tw-ring-color": accent.base } as React.CSSProperties}
                  >
                    <PartTile part={part} product={productFor(c.partId, products, getPart, c.variant)} size={56} />
                    <span className="line-clamp-2 text-xs font-semibold leading-tight text-heading">{withQuantity(nameOf(c, part), g.quantity)}</span>
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

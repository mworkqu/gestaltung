"use client";

// Step 4 · Your enclosure. "Draw it" → POST /api/studio/enclosure with the
// spec, the parts and the bounding box of our deterministic layout. Credits
// follow the CAD flow (1 CAD credit = 3 looks; 401/402 → the AccessNote with
// the 3D-model copy). The browser builds the case itself (StudioViewer,
// turntable). Colour and finish are local edits (no credit, saved to the doc);
// X-ray shows the parts inside; "Download STL (rough)" exports base and lid.
// "Name on the lid" (optional, ≤ 16) is a local edit too: debounced 400 ms,
// then the geometry worker raises it on the lid (no API call, no credit).
//
// W6 — everything 3D lives here:
//  * "Why this shape" (shape-pick.ts: placement / holding / environment / size)
//    and "Other shapes": the next three DIFFERENT templates for this product,
//    adapted from the current look (colour, finish, lid name kept). A tap is a
//    local edit like a colour (no AI, no credit); the case's printed parts are
//    worked out again (reshape).
//  * "Take it apart" toggle + slider under the 3D view: the case opens and the
//    printed stands / clips (standoffs under boards with holes, cradles …) show
//    in place. The parts list = doc.mech, else the same deterministic list the
//    Print step falls back to (no API call here).
//  * Speed: the viewer shows the last built case from this browser at once
//    (geometry/persist.ts); once the case is up, the worker builds the printed
//    parts, then the three other shapes, one at a time, first one first.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type * as THREE from "three";
import { Download, Eye, Layers, Loader2, Sparkles } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { cadCost, studioCadTier } from "@/lib/credits/cad-cost";
import { StudioViewer, type ViewerApi } from "@/components/studio/viewer/ViewerLazy";
import type { ViewerExtraObject } from "@/components/studio/viewer/types";
import { track } from "@/lib/analytics";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { arabicCountForm } from "@/lib/text/count";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { downloadBlob } from "@/lib/studio/download";
import type { EnclosureMeta } from "@/lib/studio/enclosure/build";
import { labelSupport } from "@/lib/studio/enclosure/label-font";
import { shapeReason, shapeVariants } from "@/lib/studio/enclosure/shape-pick";
import { shapeOf, stableJson } from "@/lib/studio/geometry/key";
import type { BuiltMechPart } from "@/lib/studio/mech/build";
import { layoutComponents, layoutResultOf } from "@/lib/studio/layout";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { COLOUR_HEX, STEP_ACCENT } from "@/lib/studio/palette";
import { COLOURS, FINISHES, LIMITS, type EnclosureSpec, type MechPart, type StudioDoc } from "@/lib/studio/schema";
import { fileSlug, looksLeftFromVersions } from "@/lib/studio/client/steps";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";
import { ShareActions } from "./share";
import { accessReason, problemKey } from "./problem";

const accent = STEP_ACCENT.enclosure;
/** Typing pause before the lid is rebuilt with the new name. */
const LABEL_DEBOUNCE_MS = 400;
/** "Take it apart" opens this far at once (the slider then goes 0–1). */
const APART_DEFAULT = 0.65;
/** Printed parts shown with the case (the lid, base and stake spike are the case itself). */
const isHolder = (b: BuiltMechPart) => b.template !== "lid" && b.template !== "base";

export type EnclosureTemplateProps = {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onEnclosure: (
    enclosure: EnclosureSpec,
    opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"]; reshape?: boolean },
  ) => void;
  onNext: () => void;
  /** P5-16: a line above the case when the product pictures could not be made here. */
  note?: ReactNode;
};

/**
 * The template enclosure flow (W6). Since P5-16 it is the FALLBACK of the Enclosure
 * step: projects that already have a case, browsers that cannot draw the product
 * pictures, and a product pipeline that failed (never a blank screen).
 */
export function EnclosureTemplateFlow({ ctx, doc, beforeServer, onEnclosure, onNext, note }: EnclosureTemplateProps) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const access = useCanUse("cad", ctx.api.mode === "live" ? ctx.projectId : null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [xray, setXray] = useState(false);
  const [looksLeft, setLooksLeft] = useState<number | null>(
    doc.enclosure ? looksLeftFromVersions(doc.enclosureVersions?.length ?? 1) : null,
  );
  const viewer = useRef<ViewerApi | null>(null);

  const placed = useMemo(
    () =>
      doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ c, part }] : [];
      }),
    [doc.components, getPart],
  );
  const layout = useMemo(
    () =>
      layoutComponents(
        placed.map(({ c, part }) => ({ instanceId: c.instanceId, part })),
        { clearance: doc.enclosure?.clearance, sizeHint: doc.spec.sizeHint },
      ),
    [placed, doc.enclosure?.clearance, doc.spec.sizeHint],
  );
  const viewerComponents = useMemo(
    () => placed.map(({ c }) => ({ instanceId: c.instanceId, partId: c.partId, label: c.label })),
    [placed],
  );

  async function draw() {
    setProblem(null);
    setBlocked(null);
    if (access && !access.allowed && access.reason) {
      setBlocked(access.reason);
      return;
    }
    setBusy(true);
    await beforeServer();
    const bbox = {
      w: Math.max(1, Math.round(layout.footprint.w * 10) / 10),
      d: Math.max(1, Math.round(layout.footprint.d * 10) / 10),
      h: Math.max(1, Math.round(layout.height * 10) / 10),
    };
    const r = await ctx.api.enclosure(doc.spec, doc.components, bbox, locale);
    setBusy(false);
    if (!r.ok) {
      const reason = accessReason(r);
      if (reason) setBlocked(reason);
      else setProblem(t(problemKey(r)));
      return;
    }
    if (!r.data.fallback) {
      track("cad_generated");
      creditsChanged();
    }
    setLooksLeft(r.data.versionsLeft);
    // A new look keeps the visitor's lid name.
    const kept = encRef.current?.label;
    const next = kept && !r.data.enclosure.label ? { ...r.data.enclosure, label: kept } : r.data.enclosure;
    onEnclosure(next, { serverVersion: r.data.docVersion, fresh: true, layout: layout.layout });
  }

  // Latest spec for delayed edits (a colour tap during the label debounce must survive).
  const encRef = useRef(doc.enclosure);
  encRef.current = doc.enclosure;

  function restyle(change: Partial<EnclosureSpec>) {
    if (encRef.current) onEnclosure({ ...encRef.current, ...change }, {});
  }

  // ── Name on the lid ──────────────────────────────────────────────────────
  const labelId = useId();
  const [labelDraft, setLabelDraft] = useState(doc.enclosure?.label ?? "");
  const labelTimer = useRef<number | null>(null);
  const committedLabel = doc.enclosure?.label ?? "";
  useEffect(() => {
    // Someone else changed it (a reload, a conflict) and the visitor is not typing: follow.
    if (labelTimer.current === null) setLabelDraft(committedLabel);
  }, [committedLabel]);
  useEffect(
    () => () => {
      if (labelTimer.current !== null) window.clearTimeout(labelTimer.current);
    },
    [],
  );
  function onLabelChange(value: string) {
    setLabelDraft(value);
    if (labelTimer.current !== null) window.clearTimeout(labelTimer.current);
    labelTimer.current = window.setTimeout(() => {
      labelTimer.current = null;
      const enc = encRef.current;
      if (!enc) return;
      const text = value.replace(/\s+/g, " ").trim();
      if (text === (enc.label ?? "")) return;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { label: _old, ...rest } = enc;
      onEnclosure(text ? { ...rest, label: text } : rest, {});
    }, LABEL_DEBOUNCE_MS);
  }
  // What the last built case said about its label (only trusted for the text it was built with).
  const [labelBuilt, setLabelBuilt] = useState<{ text: string; skipped?: string } | null>(null);
  // The shape the viewer has finished building (background work starts after it).
  const [readyShape, setReadyShape] = useState<string | null>(null);
  const onEnclosureMeta = useCallback((meta: EnclosureMeta | null) => {
    setLabelBuilt(meta ? { text: encRef.current?.label ?? "", skipped: meta.labelSkipped } : null);
    setReadyShape(meta && encRef.current ? stableJson(shapeOf(encRef.current)) : null);
  }, []);
  const support = labelSupport(labelDraft);
  const draftText = labelDraft.replace(/\s+/g, " ").trim();
  const labelProblem =
    !support.ok && support.reason === "script"
      ? t("labelScript")
      : !support.ok && support.reason === "chars"
        ? t("labelChars")
        : labelBuilt?.skipped === "space" && labelBuilt.text === draftText && draftText === committedLabel
          ? t("labelSpace")
          : null;

  // ── Why this shape + other shapes ────────────────────────────────────────
  const current = doc.enclosure;
  const shapeKey = current ? stableJson(shapeOf(current)) : "";
  const why = current ? shapeReason(doc.spec, current.template) : null;
  const variants = useMemo(
    () => (current ? shapeVariants(doc.spec, current) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- materials (colour / finish) are carried over at tap time
    [doc.spec, shapeKey],
  );
  function pickShape(v: EnclosureSpec) {
    const enc = encRef.current;
    if (!enc) return;
    // Keep what the visitor chose since (colour, finish, lid name); only the shape changes.
    const next: EnclosureSpec = { ...v, colour: enc.colour, finish: enc.finish };
    if (enc.accentColour) next.accentColour = enc.accentColour;
    else delete next.accentColour;
    if (enc.label) next.label = enc.label;
    else delete next.label;
    onEnclosure(next, { reshape: true });
  }

  // ── Take it apart (+ the printed stands and clips) ──────────────────────
  const [apart, setApart] = useState(false);
  const [explode, setExplode] = useState(0);
  const partsMap = useMemo(() => new Map(placed.map(({ c, part }) => [c.instanceId, part])), [placed]);
  const mechList = useMemo<MechPart[]>(() => {
    if (doc.mech.length) return doc.mech;
    if (!current || placed.length === 0) return [];
    // The same deterministic list the Print step falls back to (no API call, no credit).
    const b = layoutBounds(doc.components, layout.layout, getPart);
    const pad = 2 * (current.wall + current.clearance);
    return defaultMechParts(
      mechSummary({
        components: doc.components,
        layout: layout.layout,
        getPart,
        enclosure: b ? { w: b.w + pad, d: b.d + pad, h: b.h + pad } : { w: 60, d: 40, h: 25 },
        template: current.template,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shape, not on colour
  }, [doc.mech, shapeKey, layout, placed, getPart]);
  const mechKeyText = JSON.stringify(mechList);
  const [holders, setHolders] = useState<BuiltMechPart[] | null>(null);

  // Once the case is on screen: the printed parts, then the other shapes — one job at a time
  // in the shared worker (cached by shape), so "Take it apart" and a shape tap are instant.
  useEffect(() => {
    if (!current || readyShape !== shapeKey || placed.length === 0) return;
    let stopped = false;
    const enclosure = current;
    void (async () => {
      const geo = await import("@/lib/studio/geometry/client");
      const lr = layoutResultOf(layout.layout, partsMap);
      const env = doc.spec.environment;
      await geo.prebuildInOrder(
        [
          async () => {
            if (!mechList.length) return;
            const [enc, mech] = await Promise.all([
              geo.getEnclosureGeometry(enclosure, lr, partsMap),
              geo.getMechGeometry(enclosure, lr, partsMap, mechList, env),
            ]);
            if (!stopped) setHolders(geo.mechObjects(mech, enc).filter(isHolder));
          },
          ...variants.map((v) => () => geo.getEnclosureGeometry(v, lr, partsMap, { persist: false })),
        ],
        () => stopped,
      );
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the built shape + the parts list
  }, [readyShape, shapeKey, mechKeyText, partsMap]);
  // A new shape: the old stands and clips no longer fit.
  useEffect(() => {
    setHolders(null);
  }, [shapeKey, mechKeyText]);
  useEffect(
    () => () => {
      // Geometry belongs to the geometry cache; only the per-part materials are ours.
      for (const b of holders ?? []) ((b.object as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
    },
    [holders],
  );
  const extraObjects = useMemo<ViewerExtraObject[] | undefined>(
    () => (apart && holders ? holders.map((b) => ({ name: b.id, object: b.object, explode: b.explode })) : undefined),
    [apart, holders],
  );
  function toggleApart() {
    const next = !apart;
    setApart(next);
    setExplode(next ? APART_DEFAULT : 0);
  }

  async function downloadStl() {
    const names = ["enclosure_base", "enclosure_lid", "enclosure_spike"];
    const objects = viewer.current?.getObjects().filter((o) => names.includes(o.name)) ?? [];
    if (!objects.length) return;
    const { exportObjectsSTL } = await import("@/lib/studio/export");
    const slug = fileSlug(ctx.projectName);
    for (const f of exportObjectsSTL(objects)) {
      const which = f.name.replace(/^enclosure_/, "").replace(/\.stl$/, "");
      downloadBlob(`${slug}-${which}.stl`, f.data, "model/stl");
    }
  }

  const enclosure = doc.enclosure;
  // 0090: a new CAD session costs 1–3 CAD credits by complexity (the parts the case holds).
  const credits = cadCost(studioCadTier(doc.components.length));
  const drawLabel =
    access?.cost === "none" ? t("drawItFree") : access?.cost === "included" ? t("drawItIncluded") : t("drawItCredit", { n: credits });
  const anotherLabel =
    looksLeft !== null && looksLeft > 0
      ? t("anotherLook")
      : access?.cost === "none"
        ? t("anotherLook")
        : t("anotherLookCredit", { n: credits });

  return (
    <StepFrame
      step="enclosure"
      n={ctx.n("enclosure")}
      title={t("title_enclosure")}
      headline={t("headline_enclosure")}
      intro={t("intro_enclosure")}
      footer={
        enclosure ? (
          <MainButton onClick={onNext}>{t("next")}</MainButton>
        ) : (
          <MainButton onClick={() => void draw()} disabled={busy || placed.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            {busy ? t("drawingIt") : drawLabel}
          </MainButton>
        )
      }
      secondary={
        enclosure ? (
          <>
            <button type="button" className={linkCls} onClick={() => void draw()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
              {busy ? t("drawingIt") : anotherLabel}
            </button>
            <button type="button" className={linkCls} onClick={() => void downloadStl()}>
              <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t("downloadStl")}
            </button>
            <ShareActions ctx={ctx} viewer={viewer} accent={accent.base} disabled={busy} />
          </>
        ) : null
      }
    >
      {note}
      <div
        className={cn("relative h-[320px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[420px]", busy && "motion-safe:animate-pulse")}
        data-testid="studio-enclosure-viewer"
      >
        <StudioViewer
          components={viewerComponents}
          layout={layout.layout}
          enclosure={enclosure}
          xray={xray}
          extraObjects={extraObjects}
          explode={apart ? explode : 0}
          accent={accent.base}
          autoRotate
          ariaLabel={t("viewerEnclosure")}
          onReady={(api) => {
            viewer.current = api;
          }}
          onEnclosureMeta={onEnclosureMeta}
        />
        {enclosure && (
          <button
            type="button"
            onClick={() => setXray((v) => !v)}
            aria-pressed={xray}
            className={cn(
              "absolute end-3 top-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-neu-sm transition-colors",
              xray ? "text-white" : "bg-surface/90 text-heading backdrop-blur",
            )}
            style={xray ? { background: accent.ink } : undefined}
          >
            <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("xray")}
          </button>
        )}
      </div>

      {enclosure && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="studio-explode">
          <button
            type="button"
            onClick={toggleApart}
            aria-pressed={apart}
            data-testid="studio-take-apart"
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors",
              apart ? "text-white" : "bg-panel text-heading shadow-neu-sm hover:bg-white",
            )}
            style={apart ? { background: accent.ink } : undefined}
          >
            <Layers className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("takeApart")}
          </button>
          {apart && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
              aria-label={t("shape.apartAmount")}
              className="h-11 min-w-0 flex-1 basis-40 cursor-pointer"
              style={{ accentColor: accent.ink }}
            />
          )}
          {apart && holders && holders.length > 0 && (
            <p className="w-full text-xs text-mutedtext">{t("shape.holders")}</p>
          )}
        </div>
      )}

      {enclosure && why && (
        <p className="text-sm text-body" data-testid="studio-shape-why" data-template={enclosure.template}>
          <span className="font-bold text-heading">{t("shape.whyLabel")}</span>{" "}
          {t(why.startsWith("fit_") ? `shape.${why}` : `shape.why_${why}`)}
        </p>
      )}

      {enclosure && variants.length > 0 && (
        <fieldset className="space-y-2" data-testid="studio-other-shapes">
          <legend className="text-sm font-bold text-heading">{t("shape.others")}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const name = t(`shape.name_${v.template}`);
              return (
                <button
                  key={v.template}
                  type="button"
                  onClick={() => pickShape(v)}
                  aria-label={t("shape.tryShape", { name })}
                  data-template={v.template}
                  className="min-h-11 rounded-full bg-panel px-4 text-sm font-semibold text-heading shadow-neu-sm transition-colors hover:bg-white active:scale-95 motion-reduce:active:scale-100"
                >
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {enclosure && looksLeft !== null && looksLeft > 0 && (
        <p className="text-sm font-medium" style={{ color: accent.ink }}>
          {t("looksLeft", { n: looksLeft, count: String(looksLeft), form: arabicCountForm(looksLeft) })}
        </p>
      )}

      {!enclosure && busy && <EnclosureSkeleton label={t("drawingIt")} />}

      {enclosure && (
        <div className="space-y-4 motion-safe:animate-rise">
          <div className="space-y-2">
            <label htmlFor={labelId} className="block text-sm font-bold text-heading">
              {t("labelName")}
            </label>
            <input
              id={labelId}
              type="text"
              value={labelDraft}
              maxLength={LIMITS.label.max}
              onChange={(e) => onLabelChange(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              dir="auto"
              aria-invalid={labelProblem ? true : undefined}
              aria-describedby={labelProblem ? `${labelId}-msg` : undefined}
              data-testid="studio-lid-label"
              className="min-h-12 w-full max-w-xs rounded-full border border-white/60 bg-panel px-4 text-base uppercase text-heading shadow-neu-inset outline-none placeholder:normal-case placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
            />
            {labelProblem && (
              <p id={`${labelId}-msg`} className="text-sm font-medium text-amber-800" role="status" data-testid="studio-lid-label-msg">
                {labelProblem}
              </p>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-heading">{t("colour")}</legend>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={t("colour")}>
              {COLOURS.map((c) => {
                const on = enclosure.colour === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={t(`colour_${c}`)}
                    title={t(`colour_${c}`)}
                    onClick={() => restyle({ colour: c })}
                    className={cn("grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-95", on && "scale-105")}
                    style={{ boxShadow: on ? `0 0 0 3px #eef2f7, 0 0 0 5px ${accent.base}` : "inset 0 0 0 1px rgba(28,36,52,0.12)" }}
                  >
                    <span className="h-8 w-8 rounded-full border border-black/10" style={{ background: COLOUR_HEX[c] }} />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-heading">{t("finish")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("finish")}>
              {FINISHES.map((f) => {
                const on = enclosure.finish === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => restyle({ finish: f })}
                    className={cn(
                      "min-h-11 rounded-full px-4 text-sm font-semibold transition-colors",
                      on ? "text-white" : "bg-panel text-heading hover:bg-white",
                    )}
                    style={on ? { background: accent.ink } : undefined}
                  >
                    {t(`finish_${f}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {problem && <Problem>{problem}</Problem>}
      {blocked && <AccessNote reason={blocked} step="cad" projectName={ctx.projectName} />}
    </StepFrame>
  );
}

/** While the first look is drawn: the colour + finish rows that will appear, as grey shapes. */
function EnclosureSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="studio-enclosure-skeleton">
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        <Bar className="h-3.5 w-16" />
        <div className="flex flex-wrap gap-2.5">
          {Array.from({ length: 10 }, (_, i) => (
            <Bar key={i} className="h-11 w-11" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Bar className="h-3.5 w-14" />
        <div className="flex flex-wrap gap-2">
          {[24, 28, 20, 32, 22].map((w, i) => (
            <Bar key={i} className="h-11" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

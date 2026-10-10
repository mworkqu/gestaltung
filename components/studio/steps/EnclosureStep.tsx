"use client";

// Step 4 · Your enclosure. "Draw it" → POST /api/studio/enclosure with the
// spec, the parts and the bounding box of our deterministic layout. Credits
// follow the CAD flow (1 CAD credit = 3 looks; 401/402 → the AccessNote with
// the 3D-model copy). The browser builds the case itself (StudioViewer,
// turntable). Colour and finish are local edits (no credit, saved to the doc);
// X-ray shows the parts inside; "Download STL (rough)" exports base and lid.

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Eye, Loader2, Sparkles } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { StudioViewer, type ViewerApi } from "@/components/studio/viewer/ViewerLazy";
import { track } from "@/lib/analytics";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { arabicCountForm } from "@/lib/text/count";
import { downloadBlob, exportObjectsSTL } from "@/lib/studio/export";
import { layoutComponents } from "@/lib/studio/layout";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { COLOUR_HEX, STEP_ACCENT } from "@/lib/studio/palette";
import { COLOURS, FINISHES, type EnclosureSpec, type StudioDoc } from "@/lib/studio/schema";
import { fileSlug, looksLeftFromVersions } from "@/lib/studio/client/steps";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { linkCls, MainButton, Problem, StepFrame } from "../ui";
import { accessReason, problemKey } from "./problem";

const accent = STEP_ACCENT.enclosure;

export function EnclosureStep({
  ctx,
  doc,
  beforeServer,
  onEnclosure,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onEnclosure: (
    enclosure: EnclosureSpec,
    opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"] },
  ) => void;
  onNext: () => void;
}) {
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
    onEnclosure(r.data.enclosure, { serverVersion: r.data.docVersion, fresh: true, layout: layout.layout });
  }

  function restyle(change: Partial<EnclosureSpec>) {
    if (doc.enclosure) onEnclosure({ ...doc.enclosure, ...change }, {});
  }

  function downloadStl() {
    const objects = viewer.current?.getObjects().filter((o) => o.name === "enclosure_base" || o.name === "enclosure_lid") ?? [];
    if (!objects.length) return;
    const slug = fileSlug(ctx.projectName);
    for (const f of exportObjectsSTL(objects)) {
      const which = f.name.replace(/^enclosure_/, "").replace(/\.stl$/, "");
      downloadBlob(`${slug}-${which}.stl`, f.data, "model/stl");
    }
  }

  const enclosure = doc.enclosure;
  const drawLabel =
    access?.cost === "none" ? t("drawItFree") : access?.cost === "included" ? t("drawItIncluded") : t("drawItCredit");
  const anotherLabel =
    looksLeft !== null && looksLeft > 0
      ? t("anotherLook")
      : access?.cost === "none"
        ? t("anotherLook")
        : t("anotherLookCredit");

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
            <button type="button" className={linkCls} onClick={downloadStl}>
              <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t("downloadStl")}
            </button>
          </>
        ) : null
      }
    >
      <div
        className={cn("relative h-[320px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[420px]", busy && "motion-safe:animate-pulse")}
        data-testid="studio-enclosure-viewer"
      >
        <StudioViewer
          components={viewerComponents}
          layout={layout.layout}
          enclosure={enclosure}
          xray={xray}
          accent={accent.base}
          autoRotate
          ariaLabel={t("viewerEnclosure")}
          onReady={(api) => {
            viewer.current = api;
          }}
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

      {enclosure && looksLeft !== null && looksLeft > 0 && (
        <p className="text-sm font-medium" style={{ color: accent.ink }}>
          {t("looksLeft", { n: looksLeft, count: String(looksLeft), form: arabicCountForm(looksLeft) })}
        </p>
      )}

      {enclosure && (
        <div className="space-y-4">
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

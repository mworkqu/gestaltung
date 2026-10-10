"use client";

// Step 3 · Your wiring. "Draw my wiring" → POST /api/studio/wiring (our rules,
// no AI; every circuit costs 1 wiring credit exactly like the client
// workspace: "(1 credit)", "(free)" only when the DB says the step costs
// nothing; 401/402 → the same AccessNote). The result is the schematic SVG we
// generate ourselves (renderSchematicSVG escapes every text), shown in a
// zoomable, left-to-right frame, plus the summary line and the plain checks.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Download, Loader2, Maximize2, Minus, Plus } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { track } from "@/lib/analytics";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { downloadBlob, exportSVG } from "@/lib/studio/export";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { renderSchematicSVG, summaryLine } from "@/lib/studio/schematic";
import type { StudioDoc } from "@/lib/studio/schema";
import { fileSlug } from "@/lib/studio/client/steps";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { linkCls, MainButton, Problem, StepFrame } from "../ui";
import { accessReason, problemKey } from "./problem";

const accent = STEP_ACCENT.wiring;
const ZOOMS = [1, 1.25, 1.5, 2];
/** The schematic is never drawn narrower than this (px): sideways scroll instead of tiny labels. */
const MIN_RENDER_W = 720;

export function WiringStep({
  ctx,
  doc,
  beforeServer,
  onWiring,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onWiring: (
    w: { components: StudioDoc["components"]; netlist: StudioDoc["netlist"]; checks: StudioDoc["checks"] },
    serverVersion: number | null,
  ) => void;
  onNext: () => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const access = useCanUse("wiring", ctx.api.mode === "live" ? ctx.projectId : null);
  const free = access?.cost === "none";
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const drawn = doc.checks.length > 0 && doc.netlist.nets.length > 0;

  const svg = useMemo(() => {
    if (!drawn) return "";
    try {
      return renderSchematicSVG(doc.components, doc.netlist.nets, getPart, { locale, title: doc.spec.name });
    } catch {
      return "";
    }
  }, [drawn, doc.components, doc.netlist.nets, doc.spec.name, locale, getPart]);
  const mcuId = useMemo(() => doc.components.find((c) => getPart(c.partId)?.category === "mcu")?.instanceId ?? null, [doc.components, getPart]);
  const summary = useMemo(() => {
    try {
      return summaryLine(doc.spec, doc.components, getPart, locale);
    } catch {
      return "";
    }
  }, [doc.spec, doc.components, locale, getPart]);

  async function draw() {
    setProblem(null);
    setBlocked(null);
    if (access && !access.allowed && access.reason) {
      setBlocked(access.reason);
      track("circuit_generated", { cost: "blocked" });
      return;
    }
    setBusy(true);
    await beforeServer();
    const r = await ctx.api.wiring(doc.spec, doc.components, locale);
    setBusy(false);
    if (!r.ok) {
      const reason = accessReason(r);
      if (reason) {
        setBlocked(reason);
        track("circuit_generated", { cost: "blocked" });
      } else setProblem(t(problemKey(r)));
      return;
    }
    track("circuit_generated", { cost: "credit" });
    creditsChanged();
    onWiring(r.data, r.data.docVersion);
  }

  function download() {
    if (svg) downloadBlob(`${fileSlug(ctx.projectName)}-wiring.svg`, exportSVG(svg), "image/svg+xml");
  }

  const drawLabel = free ? t("wiringDrawFree") : t("wiringDrawCredit");

  return (
    <StepFrame
      step="wiring"
      n={ctx.n("wiring")}
      title={t("title_wiring")}
      headline={t("headline_wiring")}
      intro={t("intro_wiring")}
      footer={
        drawn ? (
          <MainButton onClick={onNext}>{t("next")}</MainButton>
        ) : (
          <MainButton onClick={() => void draw()} disabled={busy || doc.components.length === 0}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t("wiringDrawing") : drawLabel}
          </MainButton>
        )
      }
      secondary={
        drawn && svg ? (
          <button type="button" className={linkCls} onClick={download}>
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("downloadSvg")}
          </button>
        ) : null
      }
    >
      {doc.components.length === 0 && <p className="text-sm text-mutedtext">{t("wiringNeedParts")}</p>}

      {!drawn && doc.components.length > 0 && (
        <div
          aria-hidden
          className={cn("relative h-48 overflow-hidden rounded-[24px] shadow-neu-inset sm:h-64", busy && "motion-safe:animate-pulse")}
          style={{ background: `radial-gradient(circle at 30% 20%, ${accent.soft}, #eef2f7 70%)` }}
        >
          <WirePreview />
        </div>
      )}

      {drawn && svg && (
        <div className="space-y-3 motion-safe:animate-rise">
          {summary && (
            <p className="text-sm font-semibold" style={{ color: accent.ink }} dir="auto">
              {summary}
            </p>
          )}
          <SchematicFrame svg={svg} label={t("schematicLabel")} centreOn={mcuId} />
          {doc.checks.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-heading">{t("checksHeading")}</h2>
              <ul className="space-y-1.5">
                {doc.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm text-heading">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={1.75} aria-hidden />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent.ink }} strokeWidth={1.75} aria-hidden />
                    )}
                    <span className="sr-only">{c.ok ? t("checkOkSr") : t("checkFixedSr")}</span>
                    <span>{c.plain}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {problem && <Problem>{problem}</Problem>}
      {blocked && <AccessNote reason={blocked} step="wiring" projectName={ctx.projectName} />}
    </StepFrame>
  );
}

/**
 * Zoom buttons + pinch/scroll; drawings always read left to right. The diagram
 * renders at least 1 SVG unit = 1 px (and never under MIN_RENDER_W), so the pin
 * labels stay legible on a phone; the frame scrolls sideways and starts centred
 * on the main board.
 */
function SchematicFrame({ svg, label, centreOn }: { svg: string; label: string; centreOn: string | null }) {
  const t = useTranslations("Studio");
  const [z, setZ] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const vbWidth = useMemo(() => {
    const m = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
    return m ? Number(m[1]) : 0;
  }, [svg]);
  const base = Math.max(MIN_RENDER_W, vbWidth);
  const btn = "grid h-11 w-11 place-items-center rounded-full bg-surface text-heading shadow-neu-sm disabled:opacity-40";

  // Centre the main board in the visible window (on first show and after a zoom).
  useEffect(() => {
    const frame = box.current;
    if (!frame) return;
    const el = centreOn ? frame.querySelector<SVGGElement>(`[data-part="${CSS.escape(centreOn)}"]`) : null;
    const target = el?.querySelector("rect") ?? el;
    if (!target) return;
    const r = target.getBoundingClientRect();
    const c = frame.getBoundingClientRect();
    frame.scrollLeft += r.left + r.width / 2 - (c.left + c.width / 2);
  }, [svg, z, centreOn]);

  return (
    <div className="space-y-2" dir="ltr">
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" className={btn} onClick={() => setZ((v) => Math.max(0, v - 1))} disabled={z === 0} aria-label={t("zoomOut")}>
          <Minus className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button type="button" className={btn} onClick={() => setZ((v) => Math.min(ZOOMS.length - 1, v + 1))} disabled={z === ZOOMS.length - 1} aria-label={t("zoomIn")}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button type="button" className={btn} onClick={() => setZ(0)} aria-label={t("zoomFit")}>
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div
        ref={box}
        className="max-h-[70dvh] overflow-auto overscroll-contain rounded-[20px] bg-white shadow-neu-inset"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
        data-testid="studio-schematic"
        dir="ltr"
      >
        <div
          role="img"
          aria-label={label}
          style={{ width: `max(100%, ${Math.round(base * ZOOMS[z])}px)` }}
          className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          // Our own generated SVG (lib/studio/schematic.ts escapes all text).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

/** A quiet wiring sketch before the real one is drawn. */
function WirePreview() {
  const lines = ["#dc2626", "#1c2434", "#0e59c5", "#0ea5a4", "#f59e0b"];
  return (
    <svg viewBox="0 0 400 200" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect x="150" y="60" width="100" height="80" rx="12" fill="#fff" stroke="#c9d3df" />
      {lines.map((c, i) => (
        <g key={c} stroke={c} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55">
          <path d={`M150 ${75 + i * 12} H${90 - i * 6} V${30 + i * 30} H40`} strokeDasharray="6 8" />
          <path d={`M250 ${75 + i * 12} H${310 + i * 6} V${170 - i * 30} H360`} strokeDasharray="6 8" />
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx="40" cy={30 + i * 30} r="6" fill={STEP_ACCENT.wiring.base} opacity="0.5" />
      ))}
    </svg>
  );
}

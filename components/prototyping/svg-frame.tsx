"use client";

// Shows an SVG we generated ourselves: zoom, download, print.
//
// The markup comes only from our own deterministic renderers (lib/prototyping
// *-svg.ts, dimension-drawing.ts), which escape every piece of text they
// place, so it is inserted as-is. Diagrams read left to right in both
// languages — they are engineering drawings, not page layout.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Maximize2, Minus, Plus, Printer } from "lucide-react";

import { GhostButton } from "@/components/prototyping/ui";
import { minFrameWidthPx, svgAspect } from "@/lib/prototyping/svg-size";

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
// 44 px touch targets for the zoom / download / print controls.
const TOUCH = "min-h-11 min-w-11 justify-center";

/**
 * `minHeight`: the diagram never renders shorter than this on lg screens
 * (about half of it on phones). The SVG fills the frame's width; when the
 * column is too narrow for that height it scrolls sideways at a readable size
 * instead of shrinking to tiny labels (audit #38).
 */
export function SvgFrame({
  svg,
  fileName,
  title,
  minHeight = 0,
}: {
  svg: string;
  fileName: string;
  title: string;
  minHeight?: number;
}) {
  const t = useTranslations("Prototyping");
  const [zoom, setZoom] = useState(2); // index into STEPS; 1 = fit width

  const step = (d: number) => setZoom((z) => Math.min(STEPS.length - 1, Math.max(0, z + d)));

  function download() {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<!doctype html><title>${title.replace(/</g, "&lt;")}</title><style>@page{margin:12mm}body{margin:0}svg{width:100%;height:auto}</style>${svg}`
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  const scale = STEPS[zoom];
  const aspect = svgAspect(svg);
  const minW = minFrameWidthPx(aspect, minHeight);
  const minWPhone = minFrameWidthPx(aspect, Math.round(minHeight / 2));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" dir="ltr">
        <GhostButton onClick={() => step(-1)} aria-label={t("zoomOut")} className={`px-2 ${TOUCH}`} disabled={zoom === 0}>
          <Minus className="h-3.5 w-3.5" />
        </GhostButton>
        <span className="w-12 text-center font-mono text-[11px] tabular-nums text-mutedtext">{Math.round(scale * 100)}%</span>
        <GhostButton onClick={() => step(1)} aria-label={t("zoomIn")} className={`px-2 ${TOUCH}`} disabled={zoom === STEPS.length - 1}>
          <Plus className="h-3.5 w-3.5" />
        </GhostButton>
        <GhostButton onClick={() => setZoom(2)} aria-label={t("zoomFit")} title={t("zoomFit")} className={`px-2 ${TOUCH}`}>
          <Maximize2 className="h-3.5 w-3.5" />
        </GhostButton>
        <span className="flex-1" />
        <GhostButton onClick={download} className={`px-2 ${TOUCH}`}>
          <Download className="h-3.5 w-3.5" />
          {t("downloadSvg")}
        </GhostButton>
        <GhostButton onClick={print} className={`px-2 ${TOUCH}`}>
          <Printer className="h-3.5 w-3.5" />
          {t("print")}
        </GhostButton>
      </div>
      <div className="max-h-[80vh] overflow-auto rounded-xl bg-white shadow-neu-inset" dir="ltr">
        <div
          role="group"
          aria-label={title}
          style={
            {
              width: `${scale * 100}%`,
              "--svg-min-w": `${Math.round(minWPhone * scale)}px`,
              "--svg-min-w-lg": `${Math.round(minW * scale)}px`,
            } as React.CSSProperties
          }
          className="min-w-[var(--svg-min-w)] lg:min-w-[var(--svg-min-w-lg)] [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

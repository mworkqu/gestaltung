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

const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function SvgFrame({ svg, fileName, title }: { svg: string; fileName: string; title: string }) {
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" dir="ltr">
        <GhostButton onClick={() => step(-1)} aria-label={t("zoomOut")} className="px-2" disabled={zoom === 0}>
          <Minus className="h-3.5 w-3.5" />
        </GhostButton>
        <span className="w-12 text-center font-mono text-[11px] tabular-nums text-mutedtext">{Math.round(scale * 100)}%</span>
        <GhostButton onClick={() => step(1)} aria-label={t("zoomIn")} className="px-2" disabled={zoom === STEPS.length - 1}>
          <Plus className="h-3.5 w-3.5" />
        </GhostButton>
        <GhostButton onClick={() => setZoom(2)} aria-label={t("zoomFit")} className="px-2">
          <Maximize2 className="h-3.5 w-3.5" />
        </GhostButton>
        <span className="flex-1" />
        <GhostButton onClick={download} className="px-2">
          <Download className="h-3.5 w-3.5" />
          {t("downloadSvg")}
        </GhostButton>
        <GhostButton onClick={print} className="px-2">
          <Printer className="h-3.5 w-3.5" />
          {t("print")}
        </GhostButton>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-xl bg-white shadow-neu-inset" dir="ltr">
        <div
          role="group"
          aria-label={title}
          style={{ width: `${scale * 100}%` }}
          className="[&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

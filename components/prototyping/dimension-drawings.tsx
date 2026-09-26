"use client";

// Mechanical › Drawings: one dimension drawing per mechanical part, drawn from
// the part's own shape and dimensions. Anything missing is named, with a link
// straight to the input that fills it — never a box made of invented numbers.
// A part with nothing to draw yet gets one line and a link, not an empty frame.
// The not-a-cut-file warning is printed once, inside the drawing itself.

import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";

import { Card } from "@/components/prototyping/ui";
import { SvgFrame } from "@/components/prototyping/svg-frame";
import {
  DIMS,
  hasDrawableView,
  missingDims,
  renderDimensionDrawing,
  type Dim,
  type DrawingLabels,
} from "@/lib/prototyping/dimension-drawing";
import { humanPartName } from "@/lib/prototyping/parts";
import type { ProjectPart } from "@/lib/supabase/types";

/** DOM id of a part's dimension input, for "jump to the fix" links. */
export const dimFocus = (partId: string, what: Dim | "shape") => `dim-${partId}-${what}`;

export function DimensionDrawings({
  parts,
  onFix,
}: {
  parts: ProjectPart[];
  onFix: (focus: string) => void;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");

  const labels = (p: ProjectPart): DrawingLabels => ({
    dim: Object.fromEntries(DIMS.map((d) => [d, t(`dim_${d}`)])) as Record<Dim, string>,
    missing: (what) => t("dimMissing", { what }),
    noShape: t("dimNoShape"),
    front: t("viewFront"),
    top: t("viewTop"),
    side: t("viewSide"),
    flat: t("viewFlat"),
    thickness: (mm) => t("dimThickness", { mm }),
    dxfNote: t("dxfNote"),
    title: {
      part: t("tbPart"),
      material: t("material"),
      process: t("process"),
      quantity: t("tbQuantity"),
      scale: t("tbScale"),
      units: t("tbUnits"),
    },
    materialName: p.material ? tProj(`material_${p.material}`) : t("unset"),
    processName: p.process ? t(`process_${p.process}`) : t("unset"),
  });

  return (
    <Card kicker={t("discipline_mechanical")} title={t("drawingsTitle")} intro={t("drawingsIntro")}>
      {parts.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("drawingsEmpty")}</p>
      ) : (
        <ul className="space-y-6">
          {parts.map((p) => {
            const missing = missingDims(p);
            const name = humanPartName(p.name);
            if (!hasDrawableView(p))
              return (
                <li key={p.id} className="text-sm">
                  <span className="font-mono text-[11px] text-faint">{p.code}</span>{" "}
                  <span className="font-bold text-heading">{name}</span>{" "}
                  <button
                    type="button"
                    onClick={() => onFix(dimFocus(p.id, missing[0] ?? "shape"))}
                    className="text-[12px] font-semibold text-cobalt underline underline-offset-2 hover:text-cobalt-hover"
                  >
                    {t("drawingNoDims")}
                  </button>
                </li>
              );
            return (
              <li key={p.id} className="space-y-2">
                <p className="text-sm font-bold text-heading">
                  <span className="font-mono text-[11px] font-normal text-faint">{p.code}</span> {name}
                </p>
                {missing.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-inventory-bg px-3 py-2 text-[12px] text-inventory">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold">{t("dimStillNeeded")}</span>
                    {missing.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onFix(dimFocus(p.id, m))}
                        className="font-semibold underline underline-offset-2 hover:text-heading"
                      >
                        {m === "shape" ? t("dimShape") : t(`dim_${m}`)}
                      </button>
                    ))}
                  </div>
                )}
                <SvgFrame
                  svg={renderDimensionDrawing({ ...p, name }, labels(p))}
                  fileName={`${p.code}-drawing`}
                  title={`${p.code} ${name}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

"use client";

// Manufacturing recommendation. Recomputed from the current parts on every
// render — there is nothing to refresh and nothing to go stale, because it is
// a pure function of the rows above it. Deterministic rules only (engine.ts):
// the route must be explainable and repeatable, so it never goes to a model.
// It shows no lead times or scores: we have no measured figure for either.
//
// With `materialsFor` it also lists each of those parts with its material and
// process (audit #35), so the Material & process leaf shows what the route is
// built from and can be accepted right there.

import { useTranslations } from "next-intl";
import { Check, CircleAlert, Undo2 } from "lucide-react";

import { recommend } from "@/lib/prototyping/engine";
import { isCompatible, processesFor, type Process } from "@/lib/prototyping/constants";
import { Tag } from "@/components/ui/tag";
import { Card, GhostButton, PrimaryButton, Warn } from "@/components/prototyping/ui";
import type { ProjectPart } from "@/lib/supabase/types";

// The five process colours, taken from the brand palette rather than invented:
// cobalt, the lighter azure, the buy teal, the inventory ochre and ink.
const PROCESS_COLOR: Record<Process, string> = {
  "3d_printing": "#3b82f6",
  cnc_machining: "#0e59c5",
  laser_cutting: "#0f6c59",
  pcb_manufacturing: "#6e4c12",
  edm: "#1c2434",
};

export function Recommendation({
  parts,
  brief,
  accepted,
  onAccept,
  materialsFor,
  onEditParts,
}: {
  parts: ProjectPart[];
  brief: string;
  accepted: boolean;
  /** Omit to show the route without the accept action (a read-only view). */
  onAccept?: (next: boolean) => void;
  /** Parts to list with their material and process; omit for no list. */
  materialsFor?: ProjectPart[];
  /** Where a missing or clashing material/process is changed. */
  onEditParts?: () => void;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");

  const rec = recommend(
    parts.map((p) => ({
      code: p.code,
      name: p.name,
      quantity: p.quantity,
      material: p.material,
      process: p.process,
    })),
    brief
  );

  const blocking = rec.warnings.filter((w) => w.blocking);
  const needsEdit = (materialsFor ?? []).some(
    (p) => !p.material || !p.process || !isCompatible(p.material, p.process)
  );

  const materials = materialsFor && materialsFor.length > 0 && (
    <div className="space-y-2">
      <div className="min-w-0 overflow-x-auto rounded-xl bg-panel shadow-neu-inset">
        <table className="w-full min-w-[480px] text-start text-sm">
          <thead>
            <tr className="text-[11px] text-mutedtext">
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colCode")}</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("colPart")}</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("material")}</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t("process")}</th>
            </tr>
          </thead>
          <tbody>
            {materialsFor.map((p) => {
              const clash = Boolean(p.material && p.process && !isCompatible(p.material, p.process));
              return (
                <tr key={p.id} className="border-t border-borderstrong/40 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-faint">{p.code}</td>
                  <td className="px-3 py-2 font-medium text-heading">{p.name}</td>
                  <td className="px-3 py-2">
                    {p.material ? (
                      <span className={clash ? "text-destructive" : "text-heading"}>
                        {tProj(`material_${p.material}`)}
                      </span>
                    ) : (
                      <span className="text-inventory">{t("partNeed_material")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.process ? (
                      <span className={clash ? "text-destructive" : "text-heading"}>
                        {t(`process_${p.process}`)}
                      </span>
                    ) : (
                      <span className="text-inventory">{t("partNeed_process")}</span>
                    )}
                    {clash && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive">
                        <CircleAlert className="h-3 w-3 shrink-0" />
                        {t("partNeed_mismatch")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {onEditParts && needsEdit && (
        <GhostButton onClick={onEditParts} className="px-1">
          {t("editMaterials")}
        </GhostButton>
      )}
    </div>
  );

  return (
    <Card
      kicker={t("recHeading")}
      title={t("stageTitle_manufacturing")}
      intro={t("recIntro")}
    >
      {materials}
      {rec.routes.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("recEmpty")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {rec.routes.map((r) => (
              <li
                key={r.process}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
              >
                <span
                  className="h-7 w-2.5 shrink-0 rounded"
                  style={{ backgroundColor: PROCESS_COLOR[r.process] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-heading">
                    {t(`process_${r.process}`)}
                  </span>
                  <span className="block text-[11px] text-mutedtext">
                    {r.parts.map((p) => p.code).join(" · ")}
                    {r.nestable && ` — ${t("nestable")}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {rec.warnings.length > 0 && (
            <div className="space-y-2">
              {rec.warnings.map((w, i) => (
                <Warn key={`${w.key}-${i}`} blocking={w.blocking}>
                  {t(`warn_${w.key}`, {
                    ...w.params,
                    material: w.params.material
                      ? tProj(`material_${w.params.material}`)
                      : "",
                    process: w.params.process ? t(`process_${w.params.process}`) : "",
                  })}
                  {w.key === "incompatible" && typeof w.params.material === "string" && (
                    <>
                      {" "}
                      {t("tryInstead", {
                        alt:
                          processesFor(w.params.material)
                            .map((p) => t(`process_${p}`))
                            .join(" · ") || "—",
                      })}
                    </>
                  )}
                </Warn>
              ))}
            </div>
          )}

          {onAccept && (
          <div className="flex flex-wrap items-center gap-3 border-t border-borderstrong/40 pt-4">
            {accepted ? (
              <>
                <Tag variant="buy">
                  <Check className="h-3 w-3" />
                  {t("routeAccepted")}
                </Tag>
                <GhostButton onClick={() => onAccept(false)}>
                  <Undo2 className="h-3 w-3" />
                  {t("undo")}
                </GhostButton>
              </>
            ) : (
              <PrimaryButton
                onClick={() => onAccept(true)}
                disabled={blocking.length > 0}
                title={blocking.length ? t("fixFirst") : undefined}
              >
                <Check className="h-3.5 w-3.5" />
                {t("acceptRoute")}
              </PrimaryButton>
            )}
            {blocking.length > 0 && (
              <span className="text-[11px] text-destructive">{t("fixFirst")}</span>
            )}
          </div>
          )}
        </>
      )}
    </Card>
  );
}

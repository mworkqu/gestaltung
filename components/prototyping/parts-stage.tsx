"use client";

// A discipline branch's design view: the to-design parts of ONE kind, one card
// each. It serves two leaves: Concepts (what the analysis suggests designing,
// waiting to be kept or dropped) and the design leaf (kept parts), with only the design decisions — material and process for mechanical,
// the board for electronics, the scope for software. Price, stock, source and
// quantity live in the Parts list and are deliberately not repeated here.
//
// Same rows as the Parts list: creating a part here adds it there, deleting it
// there removes it here.
//
// Material and process suggestions come from the deterministic rules in
// lib/prototyping/engine; an edit keeps the original suggestion on the row so
// "we suggested X" and "revert" stay honest however many times it changes.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Plus, Ruler, Sparkles, Trash2, Undo2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  MATERIALS,
  PROCESSES,
  isCompatible,
  processesFor,
  type Discipline,
} from "@/lib/prototyping/constants";
import {
  KEEPABLE_NEEDS,
  enclosureMisfit,
  humanPartName,
  implausibleDims,
  partNeeds,
  type PartNeed,
} from "@/lib/prototyping/parts";
import { REQUIRED, SHAPES, effectiveShape, type Dim } from "@/lib/prototyping/dimension-drawing";
import { dimFocus } from "@/components/prototyping/dimension-drawings";
import { partsKey, useProjectBoards } from "@/components/prototyping/use-project-boards";
import { Tag } from "@/components/ui/tag";
import { CreatePartDialog } from "@/components/prototyping/part-dialogs";
import {
  Card,
  PrimaryButton,
  SoftButton,
  Warn,
  fieldClass,
  selectClass,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { ProjectPart } from "@/lib/supabase/types";

/** The scope field grows with its text between these, then scrolls. */
const SCOPE_MIN_ROWS = 3;
const SCOPE_MAX_ROWS = 16;

/**
 * "What it must do": a plain textarea that grows with its content from
 * SCOPE_MIN_ROWS to SCOPE_MAX_ROWS lines and only scrolls past that — the same
 * approach as the brief editor. Uncontrolled: it saves on blur.
 */
function ScopeField({
  defaultValue,
  label,
  onSave,
}: {
  defaultValue: string;
  label: string;
  onSave: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto"; // collapse to `rows`, then measure the content
    const cs = window.getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 13;
    const line = parseFloat(cs.lineHeight) || fontSize * 1.5; // "normal" parses as NaN
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    // scrollHeight includes padding but not border; height is border-box.
    const max = line * SCOPE_MAX_ROWS + padding;
    el.style.height = `${Math.min(el.scrollHeight, max) + border}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);

  // Fit the saved text on first paint, before the client sees a cramped box.
  useLayoutEffect(() => fit(), [fit]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-faint">{label}</span>
      <textarea
        ref={ref}
        defaultValue={defaultValue}
        rows={SCOPE_MIN_ROWS}
        onInput={fit}
        onBlur={(e) => onSave(e.target.value.trim())}
        className={cn(fieldClass, "resize-none overflow-hidden py-2 text-[13px]")}
      />
    </label>
  );
}

export function PartsStage({
  projectId,
  kind,
  view,
  parts,
  nextIndex,
  designNode,
  onChanged,
  onOpenDrawing,
}: {
  projectId: string;
  kind: Discipline;
  /** Concepts shows suggestions awaiting a decision; design shows kept parts. */
  view: "concepts" | "design";
  /** The to-design parts of this kind for this view only. */
  parts: ProjectPart[];
  /** Next free P-NN number across the whole project, so codes never collide. */
  nextIndex: number;
  /** The design leaf's name, for the empty Concepts state. */
  designNode: string;
  onChanged: () => Promise<void>;
  /** Mechanical parts: go to the part's dimension drawing. */
  onOpenDrawing?: (part: ProjectPart) => void;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const concepts = view === "concepts";
  // The boards that go inside: an enclosure too small for them is not ready.
  const { boards, failed: boardsFailed } = useProjectBoards(projectId, partsKey(parts));
  const needsOf = (p: ProjectPart) => partNeeds(p, { boards });

  const pending = parts.filter((p) => p.status === "suggested" && needsOf(p).every((n) => KEEPABLE_NEEDS.includes(n)));

  /** A need in words; a wrong number says which number and why. */
  function needText(part: ProjectPart, n: PartNeed): string {
    if (n === "implausible")
      return t("partNeedDetail_implausible", {
        fields: implausibleDims(part)
          .map((d) => t(`dim_${d}`))
          .join(", "),
      });
    if (n === "tooSmall") {
      const m = enclosureMisfit(part, boards);
      if (m)
        return t("partNeedDetail_tooSmall", {
          board: m.board.label,
          inner: `${m.inner[0]} × ${m.inner[1]}`,
          needed: `${m.needed[0]} × ${m.needed[1]}`,
        });
    }
    return t(`partNeed_${n}`);
  }

  async function patch(part: ProjectPart, changes: Partial<ProjectPart>) {
    setBusy(true);
    await createClient().from("project_parts").update(changes).eq("id", part.id);
    await onChanged();
    setBusy(false);
  }

  /** A material or process change is the client overriding us: record it. */
  async function changeSpec(part: ProjectPart, changes: Partial<ProjectPart>) {
    const ai_material = part.ai_material ?? part.material;
    const ai_process = part.ai_process ?? part.process;
    const next = { ...part, ...changes };
    const backToSuggestion = next.material === ai_material && next.process === ai_process;
    await patch(part, {
      ...changes,
      ai_material,
      ai_process,
      status: part.status === "added" ? "added" : backToSuggestion ? "suggested" : "edited",
    });
  }

  /** Dropping a concept deletes the row: it was never more than a suggestion. */
  async function drop(part: ProjectPart) {
    setBusy(true);
    await createClient().from("project_parts").delete().eq("id", part.id);
    await onChanged();
    setBusy(false);
  }

  async function confirmAll() {
    setBusy(true);
    const supabase = createClient();
    await Promise.all(
      pending.map((p) => supabase.from("project_parts").update({ status: "confirmed" }).eq("id", p.id))
    );
    await onChanged();
    setBusy(false);
  }

  return (
    <Card
      kicker={t(`discipline_${kind}`)}
      title={t(concepts ? `conceptsTitle_${kind}` : `designTitle_${kind}`)}
      intro={t(concepts ? "conceptsIntro" : "designIntro")}
      actions={
        <>
          {concepts && pending.length > 1 && (
            <SoftButton onClick={confirmAll} disabled={busy}>
              <Check className="h-3.5 w-3.5" />
              {t("confirmAll")}
            </SoftButton>
          )}
          {!concepts && (
            <PrimaryButton onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t(`createKind_${kind}`)}
            </PrimaryButton>
          )}
        </>
      }
    >
      {kind === "mechanical" && boardsFailed && <Warn blocking={false}>{t("boardsCheckFailed")}</Warn>}

      {parts.length === 0 ? (
        <p className="text-sm text-mutedtext">
          {concepts
            ? t("noConcepts", { branch: t(`discipline_${kind}`), node: designNode })
            : t(`noDesign_${kind}`)}
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {parts.map((part) => {
            const needs = needsOf(part);
            const edited = part.status === "edited" && part.ai_material && part.ai_process;
            const canConfirm = needs.every((n) => KEEPABLE_NEEDS.includes(n));
            return (
              <li key={part.id} className="flex flex-col gap-3 rounded-2xl bg-panel p-4 shadow-neu-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-faint">{part.code}</span>
                  {part.status === "suggested" && (
                    <Tag variant="neutral">
                      <Sparkles className="h-3 w-3" />
                      {t("suggestionTag")}
                    </Tag>
                  )}
                  {part.status === "confirmed" && (
                    <Tag variant="buy">
                      <Check className="h-3 w-3" />
                      {t("confirmedTag")}
                    </Tag>
                  )}
                  {part.status === "edited" && (
                    <Tag variant="inventory">
                      <Pencil className="h-3 w-3" />
                      {t("editedTag")}
                    </Tag>
                  )}
                  {part.status === "added" && <Tag variant="neutral">{t("addedTag")}</Tag>}
                </div>

                <div>
                  <h3 className="text-sm font-bold text-heading">{humanPartName(part.name)}</h3>
                  {kind !== "software" && part.description && (
                    <p className="mt-1 text-xs leading-relaxed text-mutedtext">{part.description}</p>
                  )}
                </div>

                {kind === "mechanical" && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">{t("material")}</span>
                      <select
                        value={part.material ?? ""}
                        onChange={(e) => changeSpec(part, { material: e.target.value || null })}
                        className={cn(selectClass, "w-full")}
                        aria-label={t("material")}
                      >
                        <option value="">{t("unset")}</option>
                        {MATERIALS.filter((m) => m !== "fr4").map((m) => (
                          <option key={m} value={m}>
                            {tProj(`material_${m}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">{t("process")}</span>
                      <select
                        value={part.process ?? ""}
                        onChange={(e) => changeSpec(part, { process: e.target.value || null })}
                        className={cn(selectClass, "w-full")}
                        aria-label={t("process")}
                      >
                        <option value="">{t("unset")}</option>
                        {PROCESSES.filter((p) => p !== "pcb_manufacturing").map((p) => (
                          <option key={p} value={p}>
                            {t(`process_${p}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {kind === "mechanical" && !concepts && (
                  <div className="space-y-2 rounded-xl bg-surface/60 p-3">
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">{t("dimShape")}</span>
                      {part.process === "laser_cutting" ? (
                        <span className="text-[12px] text-heading">{t("shape_sheet_laser")}</span>
                      ) : (
                        <select
                          id={dimFocus(part.id, "shape")}
                          value={part.shape ?? ""}
                          onChange={(e) => void patch(part, { shape: e.target.value || null })}
                          className={cn(selectClass, "w-full")}
                        >
                          <option value="">{t("unset")}</option>
                          {SHAPES.map((sh) => (
                            <option key={sh} value={sh}>
                              {t(`shape_${sh}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    {effectiveShape(part) && (
                      <div className="grid grid-cols-3 gap-2">
                        {REQUIRED[effectiveShape(part)!].map((d: Dim) => (
                          <label key={d} className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-[9px] uppercase tracking-wider text-faint">
                              {t(`dim_${d}`)} (mm)
                            </span>
                            <input
                              id={dimFocus(part.id, d)}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              defaultValue={part[d] ?? ""}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const n = v === "" ? null : Number(v);
                                if (n !== null && !(n > 0)) return;
                                if (n !== (part[d] == null ? null : Number(part[d]))) void patch(part, { [d]: n });
                              }}
                              className={cn(fieldClass, "py-1.5 text-[13px] tabular-nums")}
                              dir="ltr"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {kind === "electronics" && (
                  <p className="text-[12px] text-mutedtext">
                    {tProj("material_fr4")} · {t("process_pcb_manufacturing")}
                  </p>
                )}

                {kind === "software" && (
                  <ScopeField
                    defaultValue={part.description ?? ""}
                    label={t("scopeField")}
                    onSave={(v) => {
                      if (v !== (part.description ?? "")) void patch(part, { description: v || null });
                    }}
                  />
                )}

                {part.material && part.process && !isCompatible(part.material, part.process) && (
                  <Warn blocking>
                    {t("warn_incompatible", {
                      code: part.code,
                      name: humanPartName(part.name),
                      material: tProj(`material_${part.material}`),
                      process: t(`process_${part.process}`),
                    })}{" "}
                    {t("tryInstead", {
                      alt: processesFor(part.material)
                        .map((p) => t(`process_${p}`))
                        .join(" · ") || "—",
                    })}
                  </Warn>
                )}

                {edited && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-inventory-bg px-3 py-2 text-[11px] text-inventory">
                    <Sparkles className="h-3 w-3" />
                    <span>
                      {t("weSuggested", {
                        material: tProj(`material_${part.ai_material}`),
                        process: t(`process_${part.ai_process}`),
                      })}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() =>
                        patch(part, { material: part.ai_material, process: part.ai_process, status: "suggested" })
                      }
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                    >
                      <Undo2 className="h-3 w-3" />
                      {t("revert")}
                    </button>
                  </div>
                )}

                {needs.some((n) => n !== "confirm") && (
                  <p className="text-[11.5px] text-inventory">
                    {needs.filter((n) => n !== "confirm").map((n) => needText(part, n)).join(" · ")}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {part.status === "suggested" && (
                    <PrimaryButton
                      onClick={() => patch(part, { status: "confirmed" })}
                      disabled={busy || !canConfirm}
                      title={canConfirm ? undefined : t("fixFirst")}
                    >
                      <Check className="h-3 w-3" />
                      {t(concepts ? "keepConcept" : "confirmPart")}
                    </PrimaryButton>
                  )}
                  {concepts && (
                    <SoftButton onClick={() => drop(part)} disabled={busy} className="bg-surface">
                      <Trash2 className="h-3 w-3" />
                      {t("dropConcept")}
                    </SoftButton>
                  )}
                  {!concepts && kind === "mechanical" && onOpenDrawing && (
                    <SoftButton onClick={() => onOpenDrawing(part)} className="bg-surface">
                      <Ruler className="h-3 w-3" />
                      {t("openDrawing")}
                    </SoftButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <CreatePartDialog
          projectId={projectId}
          nextIndex={nextIndex}
          initialKind={kind}
          onClose={() => setCreating(false)}
          onAdded={onChanged}
        />
      )}
    </Card>
  );
}

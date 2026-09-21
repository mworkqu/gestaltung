"use client";

// Parts stage: the breakdown, one card per part.
//
// The rules engine proposes a material and a process; the client confirms,
// edits or replaces them. An edit keeps the original suggestion on the row so
// "we suggested X" and "revert" stay honest however many times it changes.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Plus, Ruler, Sparkles, Trash2, Undo2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  MATERIALS,
  MAX_PARTS,
  PROCESSES,
  isCompatible,
  processesFor,
} from "@/lib/prototyping/constants";
import { suggestSpec } from "@/lib/prototyping/engine";
import { Tag } from "@/components/ui/tag";
import {
  Card,
  Confidence,
  GhostButton,
  PrimaryButton,
  SoftButton,
  Warn,
  fieldClass,
  selectClass,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectPart } from "@/lib/supabase/types";

export function PartsStage({
  project,
  parts,
  nextIndex,
  onChanged,
  onGenerateSchematic,
}: {
  project: Project;
  /** The parts shown here — one branch's parts, not necessarily all of them. */
  parts: ProjectPart[];
  /** Next free P-NN number across the whole project, so codes never collide. */
  nextIndex: number;
  onChanged: () => Promise<void>;
  onGenerateSchematic: (part: ProjectPart) => void;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const processCount = new Set(parts.map((p) => p.process).filter(Boolean)).size;
  const pending = parts.filter((p) => p.status === "suggested");

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
    const backToSuggestion =
      next.material === ai_material && next.process === ai_process;
    await patch(part, {
      ...changes,
      ai_material,
      ai_process,
      status:
        part.status === "added"
          ? "added"
          : backToSuggestion
            ? "suggested"
            : "edited",
    });
  }

  async function confirmAll() {
    setBusy(true);
    const supabase = createClient();
    await Promise.all(
      pending
        .filter((p) => isCompatible(p.material, p.process))
        .map((p) => supabase.from("project_parts").update({ status: "confirmed" }).eq("id", p.id))
    );
    await onChanged();
    setBusy(false);
  }

  async function remove(part: ProjectPart) {
    setBusy(true);
    await createClient().from("project_parts").delete().eq("id", part.id);
    await onChanged();
    setBusy(false);
  }

  return (
    <>
      <Card
        kicker={t("partsHeading")}
        title={t("stageTitle_parts")}
        intro={
          parts.length
            ? t("partsIntro", { count: parts.length, processes: processCount })
            : t("stageDesc_parts")
        }
        actions={
          <>
            {pending.length > 0 && (
              <SoftButton onClick={confirmAll} disabled={busy}>
                <Check className="h-3.5 w-3.5" />
                {t("confirmAll")}
              </SoftButton>
            )}
            <PrimaryButton onClick={() => setAdding(true)} disabled={parts.length >= MAX_PARTS}>
              <Plus className="h-3.5 w-3.5" />
              {t("addPart")}
            </PrimaryButton>
          </>
        }
      >
        {parts.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("noParts")}</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {parts.map((part) => {
              const ok = isCompatible(part.material, part.process);
              const edited = part.status === "edited" && part.ai_material && part.ai_process;
              return (
                <li
                  key={part.id}
                  className="flex flex-col gap-3 rounded-2xl bg-panel p-4 shadow-neu-sm"
                >
                  <div className="flex items-center gap-2">
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
                    <span className="flex-1" />
                    {part.status === "suggested" && part.confidence > 0 && (
                      <Confidence value={part.confidence} label={t("confidence")} />
                    )}
                  </div>

                  <div>
                    <h3 className="flex items-baseline gap-2 text-sm font-bold text-heading">
                      {part.name}
                      {part.quantity > 1 && (
                        <span className="font-mono text-[11px] font-medium text-mutedtext">
                          ×{part.quantity}
                        </span>
                      )}
                    </h3>
                    {part.description && (
                      <p className="mt-1 text-xs leading-relaxed text-mutedtext">
                        {part.description}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px] gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">
                        {t("material")}
                      </span>
                      <select
                        value={part.material ?? ""}
                        onChange={(e) => changeSpec(part, { material: e.target.value })}
                        className={cn(selectClass, "w-full")}
                        aria-label={t("material")}
                      >
                        <option value="">{t("unset")}</option>
                        {MATERIALS.map((m) => (
                          <option key={m} value={m}>
                            {tProj(`material_${m}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">
                        {t("process")}
                      </span>
                      <select
                        value={part.process ?? ""}
                        onChange={(e) => changeSpec(part, { process: e.target.value })}
                        className={cn(selectClass, "w-full")}
                        aria-label={t("process")}
                      >
                        <option value="">{t("unset")}</option>
                        {PROCESSES.map((p) => (
                          <option key={p} value={p}>
                            {t(`process_${p}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-faint">
                        {t("quantity")}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={part.quantity}
                        onChange={(e) =>
                          patch(part, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })
                        }
                        className={cn(selectClass, "w-full text-center")}
                        aria-label={t("quantity")}
                      />
                    </label>
                  </div>

                  {!ok && part.material && part.process && (
                    <Warn blocking>
                      {t("warn_incompatible", {
                        code: part.code,
                        name: part.name,
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
                          patch(part, {
                            material: part.ai_material,
                            process: part.ai_process,
                            status: "suggested",
                          })
                        }
                        className="inline-flex items-center gap-1 font-semibold hover:underline"
                      >
                        <Undo2 className="h-3 w-3" />
                        {t("revert")}
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {part.status === "suggested" && (
                      <PrimaryButton
                        onClick={() => patch(part, { status: "confirmed" })}
                        disabled={busy || !ok}
                        title={ok ? undefined : t("fixFirst")}
                      >
                        <Check className="h-3 w-3" />
                        {t("confirmPart")}
                      </PrimaryButton>
                    )}
                    <SoftButton onClick={() => onGenerateSchematic(part)} className="bg-surface">
                      <Ruler className="h-3 w-3" />
                      {t("generate")}
                    </SoftButton>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => remove(part)}
                      aria-label={t("deletePart")}
                      title={t("deletePart")}
                      className="rounded-md p-1.5 text-mutedtext transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {adding && (
        <AddPartDialog
          projectId={project.id}
          nextIndex={nextIndex}
          onClose={() => setAdding(false)}
          onAdded={onChanged}
        />
      )}
    </>
  );
}

function AddPartDialog({
  projectId,
  nextIndex,
  onClose,
  onAdded,
}: {
  projectId: string;
  nextIndex: number;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState(1);
  const [material, setMaterial] = useState("");
  const [process, setProcess] = useState("");
  const [suggestion, setSuggestion] = useState<ReturnType<typeof suggestSpec> | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await createClient()
      .from("project_parts")
      .insert({
        project_id: projectId,
        code: `P-${String(nextIndex).padStart(2, "0")}`,
        name: name.trim(),
        description: desc.trim() || null,
        quantity: qty,
        material: material || null,
        process: process || null,
        status: "added",
        confidence: 0,
        position: nextIndex,
      });
    await onAdded();
    setBusy(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-6 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("addPartTitle")}
        className="neu max-h-[calc(100vh-3rem)] w-full max-w-lg space-y-4 overflow-y-auto p-6 sm:p-8"
      >
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-heading">
            {t("addPartTitle")}
          </h2>
          <p className="mt-1 text-sm text-mutedtext">{t("addPartSub")}</p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-heading">{t("partName")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className={cn(fieldClass, "py-2.5")}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-heading">{t("partDesc")}</span>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            className={cn(fieldClass, "resize-y py-2.5")}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-heading">{t("material")}</span>
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className={cn(selectClass, "w-full py-2.5")}
            >
              <option value="">{t("unset")}</option>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {tProj(`material_${m}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-heading">{t("process")}</span>
            <select
              value={process}
              onChange={(e) => setProcess(e.target.value)}
              className={cn(selectClass, "w-full py-2.5")}
            >
              <option value="">{t("unset")}</option>
              {PROCESSES.map((p) => (
                <option key={p} value={p}>
                  {t(`process_${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-heading">{t("quantity")}</span>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className={cn(selectClass, "w-full py-2.5 text-center")}
            />
          </label>
        </div>

        {/* A suggestion, shown as a suggestion — it fills nothing until clicked. */}
        <div className="space-y-2">
          <SoftButton onClick={() => setSuggestion(suggestSpec(`${name} ${desc}`))}>
            <Sparkles className="h-3.5 w-3.5" />
            {t("suggestSpec")}
          </SoftButton>
          {suggestion && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-cobalt/[0.07] px-3 py-2 text-xs text-heading">
              <span className="min-w-0 flex-1">
                {t("suggestBecause", {
                  material: tProj(`material_${suggestion.material}`),
                  process: t(`process_${suggestion.process}`),
                  reason: t(`reason_${suggestion.reasonKey}`),
                })}
              </span>
              <Confidence value={suggestion.confidence} label={t("confidence")} />
              <PrimaryButton
                onClick={() => {
                  setMaterial(suggestion.material);
                  setProcess(suggestion.process);
                }}
              >
                {t("useSuggestion")}
              </PrimaryButton>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <GhostButton onClick={onClose}>{t("cancel")}</GhostButton>
          <PrimaryButton onClick={add} disabled={busy || !name.trim()}>
            <Plus className="h-3.5 w-3.5" />
            {t("addPart")}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

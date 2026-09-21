"use client";

// A discipline branch's design view: the to-design parts of ONE kind, one card
// each, with only the design decisions — material and process for mechanical,
// the board for electronics, the scope for software. Price, stock, source and
// quantity live in the Parts list and are deliberately not repeated here.
//
// Same rows as the Parts list: creating a part here adds it there, deleting it
// there removes it here.
//
// Material and process suggestions come from the deterministic rules in
// lib/prototyping/engine; an edit keeps the original suggestion on the row so
// "we suggested X" and "revert" stay honest however many times it changes.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Plus, Ruler, Sparkles, Undo2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  MATERIALS,
  PROCESSES,
  isCompatible,
  processesFor,
  type Discipline,
} from "@/lib/prototyping/constants";
import { partNeeds } from "@/lib/prototyping/parts";
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

export function PartsStage({
  projectId,
  kind,
  parts,
  nextIndex,
  onChanged,
  onGenerateSchematic,
}: {
  projectId: string;
  kind: Discipline;
  /** The to-design parts of this kind only. */
  parts: ProjectPart[];
  /** Next free P-NN number across the whole project, so codes never collide. */
  nextIndex: number;
  onChanged: () => Promise<void>;
  onGenerateSchematic: (part: ProjectPart) => void;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const pending = parts.filter((p) => p.status === "suggested" && partNeeds(p).every((n) => n === "confirm"));

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
      title={t(`designTitle_${kind}`)}
      intro={t("designIntro")}
      actions={
        <>
          {pending.length > 1 && (
            <SoftButton onClick={confirmAll} disabled={busy}>
              <Check className="h-3.5 w-3.5" />
              {t("confirmAll")}
            </SoftButton>
          )}
          <PrimaryButton onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t(`createKind_${kind}`)}
          </PrimaryButton>
        </>
      }
    >
      {parts.length === 0 ? (
        <p className="text-sm text-mutedtext">{t(`noDesign_${kind}`)}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {parts.map((part) => {
            const needs = partNeeds(part);
            const edited = part.status === "edited" && part.ai_material && part.ai_process;
            const canConfirm = needs.every((n) => n === "confirm");
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
                  <h3 className="text-sm font-bold text-heading">{part.name}</h3>
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

                {kind === "electronics" && (
                  <p className="text-[12px] text-mutedtext">
                    {tProj("material_fr4")} · {t("process_pcb_manufacturing")}
                  </p>
                )}

                {kind === "software" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-wider text-faint">{t("scopeField")}</span>
                    <textarea
                      defaultValue={part.description ?? ""}
                      rows={3}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (part.description ?? "")) void patch(part, { description: v || null });
                      }}
                      className={cn(fieldClass, "resize-y py-2 text-[13px]")}
                    />
                  </label>
                )}

                {part.material && part.process && !isCompatible(part.material, part.process) && (
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
                    {needs.filter((n) => n !== "confirm").map((n) => t(`partNeed_${n}`)).join(" · ")}
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
                      {t("confirmPart")}
                    </PrimaryButton>
                  )}
                  {kind !== "software" && (
                    <SoftButton onClick={() => onGenerateSchematic(part)} className="bg-surface">
                      <Ruler className="h-3 w-3" />
                      {t("generate")}
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

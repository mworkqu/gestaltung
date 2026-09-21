"use client";

// Design stage: 2D schematics with a real revision history.
//
// A revision is never overwritten. Regenerating or refining adds the next one
// and marks the previous ready revision superseded, so a client can always
// look at what they had before and restore it. A drawing we cannot honestly
// produce (a flat pattern for a non-sheet material) is recorded as a failed
// revision with the reason, not silently skipped.

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  CircleAlert,
  Download,
  History,
  Pencil,
  Printer,
  RefreshCw,
  Ruler,
  Undo2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { applyPrompt, BASE_FEATURES, drawSchematic, drawingBlocked } from "@/lib/prototyping/schematic";
import type { SchematicKind } from "@/lib/prototyping/constants";
import { Tag } from "@/components/ui/tag";
import {
  Card,
  Confidence,
  GhostButton,
  PrimaryButton,
  SoftButton,
  StatusTag,
  fieldClass,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type {
  ProjectPart,
  ProjectSchematic,
  ProjectSchematicRevision,
} from "@/lib/supabase/types";

export type SchematicWithRevs = ProjectSchematic & { revs: ProjectSchematicRevision[] };

const current = (s: SchematicWithRevs) => s.revs[s.revs.length - 1];
const latestReady = (s: SchematicWithRevs) =>
  [...s.revs].reverse().find((r) => r.status === "ready");

/**
 * Draws the next revision of a schematic and writes it. Shared by the parts
 * stage ("generate" on a part) and the buttons in here.
 */
export async function createRevision({
  schematic,
  part,
  code,
  title,
  kind,
  prompt,
  restoreFrom,
  materialLabel,
  projectId,
  errorText,
}: {
  schematic: SchematicWithRevs | null;
  part: ProjectPart | null;
  code: string;
  title: string;
  kind: SchematicKind;
  prompt?: string | null;
  restoreFrom?: ProjectSchematicRevision | null;
  materialLabel: string;
  projectId: string;
  errorText: (key: string, params: Record<string, string>) => string;
}) {
  const supabase = createClient();

  let schematicId = schematic?.id;
  if (!schematicId) {
    const { data, error } = await supabase
      .from("project_schematics")
      .insert({
        project_id: projectId,
        part_id: part?.id ?? null,
        code,
        title,
        kind,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("schematic insert failed");
    schematicId = data.id as string;
  }

  const rev = schematic ? current(schematic).rev + 1 : 1;

  // Features carry forward from the revision we are building on, so a refine
  // adds to the drawing instead of resetting it.
  const base = restoreFrom?.note
    ? BASE_FEATURES
    : schematic
      ? featuresOf(latestReady(schematic))
      : BASE_FEATURES;
  const features = prompt ? applyPrompt(base, prompt) : base;

  const blocked = drawingBlocked(kind, part?.material ?? null);
  const svg = blocked
    ? null
    : drawSchematic({
        code,
        rev,
        kind,
        title,
        material: materialLabel,
        quantity: part?.quantity ?? 1,
        features,
      });

  // Only one revision is "the current drawing"; the rest become history.
  if (schematic) {
    const ready = schematic.revs.filter((r) => r.status === "ready").map((r) => r.id);
    if (ready.length) {
      await supabase
        .from("project_schematic_revisions")
        .update({ status: "superseded" })
        .in("id", ready);
    }
  }

  await supabase.from("project_schematic_revisions").insert({
    schematic_id: schematicId,
    rev,
    status: blocked ? "failed" : "ready",
    prompt: prompt ?? null,
    note: restoreFrom ? `restored from rev ${restoreFrom.rev}` : null,
    svg,
    error: blocked
      ? errorText(`error_${blocked}`, { material: materialLabel })
      : features.noteKeys.includes("unrecognised") && prompt
        ? errorText("note_unrecognised", { prompt })
        : null,
    confidence: blocked ? null : 70,
  });

  return schematicId;
}

/** Reconstructs which drawing features a revision was built with. */
function featuresOf(rev: ProjectSchematicRevision | undefined) {
  if (!rev?.svg) return BASE_FEATURES;
  return {
    ...BASE_FEATURES,
    dimensions: rev.svg.includes("stroke-width=\"1\"") && rev.svg.includes("monospace"),
    vents: rev.svg.includes("VENTS") || /rect x="30[0-9]" y="1[0-9][0-9]"/.test(rev.svg),
    holes: rev.svg.includes("<circle"),
    section: rev.svg.includes("stroke-dasharray=\"5 3\""),
    noteKeys: [],
  };
}

export function SchematicsStage({
  projectId,
  parts,
  schematics,
  onChanged,
}: {
  projectId: string;
  parts: ProjectPart[];
  schematics: SchematicWithRevs[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [refining, setRefining] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const active = schematics.find((s) => s.id === activeId) ?? schematics[0] ?? null;
  const cur = active ? current(active) : null;
  const shown = active
    ? (viewRev ? active.revs.find((r) => r.rev === viewRev) : null) ??
      latestReady(active) ??
      cur
    : null;
  const part = active?.part_id ? parts.find((p) => p.id === active.part_id) ?? null : null;

  async function revise(opts: { prompt?: string; restoreFrom?: ProjectSchematicRevision }) {
    if (!active) return;
    setBusy(true);
    await createRevision({
      schematic: active,
      part,
      code: active.code,
      title: active.title,
      kind: active.kind as SchematicKind,
      prompt: opts.prompt ?? null,
      restoreFrom: opts.restoreFrom ?? null,
      materialLabel: part?.material ? tProj(`material_${part.material}`) : "—",
      projectId,
      errorText: (k, p) => t(k, p),
    });
    setPrompt("");
    setRefining(false);
    setViewRev(null);
    await onChanged();
    setBusy(false);
  }

  function download() {
    if (!shown?.svg || !active) return;
    const blob = new Blob([shown.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.code}_rev${shown.rev}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!schematics.length) {
    return (
      <Card kicker={t("schHeading")} title={t("stageTitle_design")} intro={t("schIntro")}>
        <p className="text-sm text-mutedtext">{t("schEmpty")}</p>
      </Card>
    );
  }

  return (
    <Card kicker={t("schHeading")} title={t("stageTitle_design")} intro={t("schIntro")}>
      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* Document list */}
        <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {schematics.map((s) => {
            const c = current(s);
            return (
              <li key={s.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(s.id);
                    setViewRev(null);
                    setRefining(false);
                  }}
                  aria-current={s.id === active?.id}
                  className={cn(
                    "w-full space-y-1 rounded-xl px-3 py-2.5 text-start transition-colors",
                    s.id === active?.id
                      ? "bg-panel shadow-neu-inset"
                      : "hover:bg-panel/60"
                  )}
                >
                  <span className="block font-mono text-[10px] text-faint">
                    {s.code} · {t("revision", { rev: c.rev })}
                  </span>
                  <span className="block truncate text-xs font-semibold text-heading">
                    {s.title}
                  </span>
                  <StatusTag
                    status={c.status === "generating" ? "generating" : c.status}
                    label={t(`${c.status}Tag`)}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        {/* Viewer */}
        {active && shown && (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-faint">{active.code}</span>
              <h3 className="text-sm font-bold text-heading">{active.title}</h3>
              <Tag variant="neutral">{t("revision", { rev: shown.rev })}</Tag>
              <StatusTag
                status={shown.status === "generating" ? "generating" : shown.status}
                label={t(`${shown.status}Tag`)}
              />
              {shown.confidence != null && (
                <Confidence value={shown.confidence} label={t("confidence")} />
              )}
              {part && (
                <span className="text-[11px] text-mutedtext">
                  {t("forPart", { code: part.code, name: part.name })}
                </span>
              )}
            </div>

            {viewRev && cur && shown.rev !== cur.rev && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-inventory-bg px-3 py-2 text-[11.5px] text-inventory">
                <History className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">
                  {t("viewingOld", { rev: shown.rev, current: cur.rev })}
                </span>
                <SoftButton onClick={() => setViewRev(null)} className="bg-surface">
                  {t("backToCurrent")}
                </SoftButton>
                {shown.status !== "failed" && (
                  <PrimaryButton onClick={() => revise({ restoreFrom: shown })} disabled={busy}>
                    <Undo2 className="h-3 w-3" />
                    {t("restore")}
                  </PrimaryButton>
                )}
              </div>
            )}

            <div className="neu-inset relative overflow-hidden p-3">
              {shown.status === "failed" ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-destructive shadow-neu-sm">
                    <CircleAlert className="h-5 w-5" />
                  </span>
                  <p className="max-w-[46ch] text-sm text-heading">{shown.error}</p>
                </div>
              ) : (
                <div
                  className="[&_svg]:h-auto [&_svg]:w-full"
                  // Generated locally by lib/prototyping/schematic.ts from our own
                  // template strings — no user HTML reaches this.
                  dangerouslySetInnerHTML={{ __html: shown.svg ?? "" }}
                />
              )}
            </div>

            {shown.error && shown.status === "ready" && (
              <p className="text-[11px] text-inventory">{shown.error}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SoftButton onClick={() => revise({})} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t("regenerate")}
              </SoftButton>
              <SoftButton onClick={() => setRefining((v) => !v)} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" />
                {t("refine")}
              </SoftButton>
              <SoftButton onClick={download} disabled={!shown.svg}>
                <Download className="h-3.5 w-3.5" />
                {t("download")}
              </SoftButton>
              <SoftButton onClick={() => window.print()} disabled={!shown.svg}>
                <Printer className="h-3.5 w-3.5" />
                {t("print")}
              </SoftButton>
            </div>

            {refining && (
              <div className="flex flex-wrap gap-2">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && prompt.trim()) void revise({ prompt: prompt.trim() });
                  }}
                  placeholder={t("refinePlaceholder")}
                  autoFocus
                  className={cn(fieldClass, "min-w-[220px] flex-1 py-2.5")}
                />
                <PrimaryButton
                  onClick={() => prompt.trim() && revise({ prompt: prompt.trim() })}
                  disabled={busy || !prompt.trim()}
                >
                  <Ruler className="h-3.5 w-3.5" />
                  {t("generate")}
                </PrimaryButton>
                <GhostButton onClick={() => setRefining(false)}>{t("cancel")}</GhostButton>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-heading">
                <History className="h-3.5 w-3.5" />
                {t("history")}
              </h4>
              <ul className="space-y-1.5">
                {[...active.revs].reverse().map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setViewRev(r.rev)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition-colors",
                        shown.rev === r.rev ? "bg-panel shadow-neu-inset" : "hover:bg-panel/60"
                      )}
                    >
                      <span
                        className={cn(
                          "w-16 shrink-0 font-mono text-[11px] font-medium",
                          r.status === "superseded"
                            ? "text-faint line-through"
                            : "text-heading"
                        )}
                      >
                        {t("revision", { rev: r.rev })}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-mutedtext">
                        {r.prompt ? `“${r.prompt}”` : r.note ?? "—"}
                      </span>
                      <StatusTag
                        status={r.status === "generating" ? "generating" : r.status}
                        label={t(`${r.status}Tag`)}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

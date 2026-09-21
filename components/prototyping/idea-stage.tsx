"use client";

// The Brief node, in three zones:
//   1. the brief editor;
//   2. "What we understood" — a spec sheet confirmed as one block;
//   3. "Needs your input" — real controls for what the analysis left open.
//
// Analysis runs on the server (/api/analyse) and streams its real progress.
// Whatever it returns is merged by mergeAnalysis(): the client's own answers
// always win. Nothing here writes progress — readiness derives it.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  ANALYSIS_STEPS,
  type Analysis,
  type AnalysisEvent,
  type AnalysisStep,
} from "@/lib/prototyping/analysis";
import { MIN_BRIEF_CHARS } from "@/lib/prototyping/constants";
import { suggestSpec } from "@/lib/prototyping/engine";
import { looksLikeSchema } from "@/lib/prototyping/readiness";
import { answersOf, mergeAnalysis, type Spec } from "@/lib/prototyping/spec";
import { BriefEditor, type SaveState } from "@/components/prototyping/brief-editor";
import { NeedsInput, SpecSheet } from "@/components/prototyping/spec-sheet";
import { Card, PrimaryButton, Warn } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectPart } from "@/lib/supabase/types";

/** Long enough that a fast analysis doesn't flash its progress. */
const MIN_VISIBLE_MS = 400;

type ResultEvent = Extract<AnalysisEvent, { type: "result" }>;

/** Reads the NDJSON stream, reporting each step as the server finishes it. */
async function streamAnalysis(res: Response, onStep: (s: AnalysisStep) => void): Promise<ResultEvent | null> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ResultEvent | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as AnalysisEvent;
      if (e.type === "step") onStep(e.step);
      if (e.type === "result") result = e;
    }
    if (done) return result;
  }
}

/** Material + process for a suggested part: deterministic rules, not a model. */
function specFor(p: Analysis["suggestedParts"][number]) {
  if (p.kind === "software") return { material: null, process: null };
  if (p.kind === "electronics") return { material: "fr4", process: "pcb_manufacturing" };
  const s = suggestSpec(`${p.name} ${p.note}`);
  return { material: s.material, process: s.process };
}

export function IdeaStage({
  project,
  parts,
  onChanged,
  onSpec,
}: {
  project: Project;
  parts: ProjectPart[];
  onChanged: () => Promise<void>;
  onSpec: (next: Spec) => void;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const [brief, setBrief] = useState(project.brief ?? "");
  const [savedBrief, setSavedBrief] = useState(project.brief ?? "");
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<AnalysisStep[]>([]);
  const [problem, setProblem] = useState<"short" | "schema" | "failed" | null>(null);
  const spec = project.spec ?? null;

  // Closing the tab skips blur, so warn while there is unsaved text.
  useEffect(() => {
    if (saveState !== "dirty" && saveState !== "error") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  function onBriefChange(value: string) {
    setBrief(value);
    setSaveState(value === savedBrief ? "clean" : "dirty");
  }

  /** Saves the brief if it changed. Resolves false if the write failed. */
  async function saveBrief(): Promise<boolean> {
    if (brief === savedBrief && saveState !== "error") return true;
    setSaveState("saving");
    const { error } = await createClient()
      .from("projects")
      .update({ brief: brief || null })
      .eq("id", project.id);
    if (error) {
      setSaveState("error");
      return false;
    }
    setSavedBrief(brief);
    setSaveState("saved");
    await onChanged();
    return true;
  }

  async function runAnalysis() {
    if (looksLikeSchema(brief)) return setProblem("schema");
    if (brief.trim().length < MIN_BRIEF_CHARS) return setProblem("short");
    setProblem(null);
    setDone([]);
    setRunning(true);
    const started = Date.now();
    const mark = (s: AnalysisStep) => setDone((d) => (d.includes(s) ? d : [...d, s]));
    const supabase = createClient();

    try {
      if (!(await saveBrief())) throw new Error("brief not saved");

      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, answers: answersOf(spec), locale }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const result = await streamAnalysis(res, mark);
      if (!result) throw new Error("no result");

      // Checking for gaps: merge with what the client already decided.
      const merged = mergeAnalysis(spec, result.analysis, {
        provider: result.provider,
        fallback: result.fallback,
      });
      const { error } = await supabase
        .from("projects")
        .update({
          spec: merged,
          // Only `detected` is rewritten; manual branch choices are kept.
          disciplines: { ...(project.disciplines ?? {}), detected: result.analysis.disciplines },
        })
        .eq("id", project.id);
      if (error) throw error;

      // Suggested parts become to-design parts, unless one with that name
      // exists already — a part the client touched is never replaced.
      const have = new Set(parts.map((p) => p.name.trim().toLowerCase()));
      let n = Math.max(0, ...parts.map((p) => parseInt(p.code.replace(/\D/g, ""), 10) || 0));
      const rows = result.analysis.suggestedParts
        .filter((p) => !have.has(p.name.trim().toLowerCase()))
        .map((p) => {
          const s = specFor(p);
          n += 1;
          return {
            project_id: project.id,
            code: `P-${String(n).padStart(2, "0")}`,
            position: n,
            name: p.name,
            description: p.note || null,
            quantity: 1,
            source: "to_design" as const,
            kind: p.kind,
            material: s.material,
            process: s.process,
            ai_material: s.material,
            ai_process: s.process,
            status: "suggested" as const,
          };
        });
      if (rows.length) {
        const ins = await supabase.from("project_parts").insert(rows);
        if (ins.error) throw ins.error;
      }
      mark("gaps");
    } catch {
      setProblem("failed");
    }

    const wait = MIN_VISIBLE_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await onChanged();
    setRunning(false);
  }

  const analysed = !!spec;
  const current = ANALYSIS_STEPS.find((s) => !done.includes(s));

  return (
    <>
      <Card kicker={t("briefHeading")} title={t("stageTitle_idea")} intro={t("briefIntro")}>
        <BriefEditor
          value={brief}
          onChange={onBriefChange}
          onSave={() => void saveBrief()}
          state={saveState}
        />
        {problem && (
          <p className="text-xs font-medium text-destructive">
            {t(
              problem === "short"
                ? "briefTooShort"
                : problem === "schema"
                  ? "block_briefSchema"
                  : "analyseFailed"
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={runAnalysis} disabled={running}>
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {running ? t("analysing") : analysed ? t("reanalyse") : t("analyse")}
          </PrimaryButton>
          {analysed && !running && (
            <span className="text-[11px] text-mutedtext">{t("reanalyseKeeps")}</span>
          )}
        </div>

        {running && (
          <ol className="space-y-1.5" aria-live="polite">
            {ANALYSIS_STEPS.map((s) => {
              const isDone = done.includes(s);
              const active = s === current;
              return (
                <li
                  key={s}
                  className={cn(
                    "flex items-center gap-2 text-[12px]",
                    isDone ? "text-heading" : active ? "text-cobalt" : "text-faint"
                  )}
                >
                  <span className="grid h-4 w-4 place-items-center">
                    {isDone ? (
                      <Check className="h-3.5 w-3.5 text-buy" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-faint" />
                    )}
                  </span>
                  {t(`step_${s}`)}
                </li>
              );
            })}
          </ol>
        )}

        {/* Never a silent downgrade: say plainly when the basic reader answered. */}
        {!running && spec?.fallback && (
          <Warn blocking={false}>
            {t("usedBasicReader", { reason: t(`fallback_${spec.fallback}`) })}
          </Warn>
        )}
      </Card>

      <SpecSheet spec={spec} running={running} onChange={onSpec} />
      {!running && <NeedsInput spec={spec} onChange={onSpec} />}
    </>
  );
}

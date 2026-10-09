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

import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import {
  ANALYSIS_STEPS,
  type Analysis,
  type AnalysisEvent,
  type AnalysisStep,
} from "@/lib/prototyping/analysis";
import { MIN_BRIEF_CHARS } from "@/lib/prototyping/constants";
import { suggestSpec } from "@/lib/prototyping/engine";
import { disciplineOf } from "@/lib/prototyping/parts";
import { mergeBom } from "@/lib/prototyping/bom";
import { looksLikeSchema } from "@/lib/prototyping/readiness";
import {
  EMPTY_SPEC,
  aiConsentOf,
  answersOf,
  isAnalysed,
  mergeAnalysis,
  type AiConsent,
  type Spec,
} from "@/lib/prototyping/spec";
import { BriefEditor, type SaveState } from "@/components/prototyping/brief-editor";
import { UnderstoodPanel } from "@/components/prototyping/understood-panel";
import { Card, PrimaryButton, Warn } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectPart } from "@/lib/supabase/types";
import { BriefChat } from "@/components/prototyping/brief-chat";
import { ReadAloud } from "@/components/prototyping/read-aloud";

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

/**
 * Material + process for a suggested part: deterministic rules, not a model.
 * The brief goes too, so "a small 3D-printed case" decides the enclosure.
 */
function specFor(p: Analysis["suggestedParts"][number], brief: string) {
  if (p.kind === "software") return { material: null, process: null };
  if (p.kind === "electronics") return { material: "fr4", process: "pcb_manufacturing" };
  const s = suggestSpec(`${p.name} ${p.note}`, brief);
  return { material: s.material, process: s.process };
}

/**
 * A consent date in the page's language, e.g. "26 Sept 2026" / "26 سبتمبر 2026".
 * Arabic keeps Western digits (owner decision 7a), hence the nu-latn extension.
 */
function formatConsentDate(iso: string, locale: "en" | "ar") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function IdeaStage({
  project,
  parts,
  onChanged,
  onSpec,
  briefDestination,
  startChat = false,
}: {
  project: Project;
  parts: ProjectPart[];
  onChanged: () => Promise<void>;
  onSpec: (next: Spec) => void;
  /** Who receives the brief for analysis; null = the rules reader on our server. */
  briefDestination: string | null;
  /** Opened from "Describe your idea": the chat opens with the first turn. */
  startChat?: boolean;
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
  // Before the first analysis with an outside provider, the client must agree
  // to send their brief there (audit #10). The rules reader never leaves our
  // server, so it asks nothing.
  const consent = briefDestination ? aiConsentOf(spec, briefDestination) : null;
  const needsConsent = !!briefDestination && !consent;
  const [consentTicked, setConsentTicked] = useState(false);

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

  // The chat's paragraph is appended and saved at once (it's the client's click).
  // Resolves the saved brief, or null when the write failed.
  async function addToBrief(text: string): Promise<string | null> {
    const next = [brief.trim(), text.trim()].filter(Boolean).join("\n\n");
    setBrief(next);
    setSaveState("saving");
    const { error } = await createClient().from("projects").update({ brief: next }).eq("id", project.id);
    if (error) {
      setSaveState("error");
      return null;
    }
    setSavedBrief(next);
    setSaveState("saved");
    await onChanged();
    return next;
  }

  // "Add and analyse" (P2-03): one click in the chat appends the paragraph and
  // starts the analysis. The analysis itself is not awaited, so the chat can
  // close while the progress list shows behind it. Resolves false when the
  // brief could not be saved (nothing is analysed then).
  async function addAndAnalyse(text: string): Promise<boolean> {
    const next = await addToBrief(text);
    if (next === null) return false;
    void runAnalysis(next);
    return true;
  }

  // `briefOverride` is the brief that was just saved by "Add and analyse",
  // because this closure still holds the text from before the add.
  async function runAnalysis(briefOverride?: string) {
    if (running) return;
    if (needsConsent && !consentTicked) return;
    const text = briefOverride ?? brief;
    if (looksLikeSchema(text)) return setProblem("schema");
    if (text.trim().length < MIN_BRIEF_CHARS) return setProblem("short");
    setProblem(null);
    setDone([]);
    setRunning(true);
    const started = Date.now();
    const mark = (s: AnalysisStep) => setDone((d) => (d.includes(s) ? d : [...d, s]));
    const supabase = createClient();

    try {
      if (briefOverride === undefined && !(await saveBrief())) throw new Error("brief not saved");

      // The consent covers this send, so it is stamped as the request leaves.
      // It is stored with the analysis's spec below (the one spec write), and
      // mergeAnalysis keeps it through every later re-analysis.
      const newConsent: AiConsent | null =
        needsConsent && briefDestination
          ? { at: new Date().toISOString(), destination: briefDestination }
          : null;
      const consentAt = (newConsent ?? consent)?.at;

      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The route validates its body with a non-strict schema, so it accepts
        // (and for now ignores) the consent timestamp.
        body: JSON.stringify({
          brief: text,
          answers: answersOf(spec),
          locale,
          projectId: project.id,
          ...(consentAt ? { consentAt } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const result = await streamAnalysis(res, mark);
      if (!result) throw new Error("no result");

      // Checking for gaps: merge with what the client already decided.
      const merged = mergeAnalysis(spec, result.analysis, {
        provider: result.provider,
        fallback: result.fallback,
      });
      if (newConsent) merged.aiConsent = newConsent;
      const { error } = await supabase
        .from("projects")
        .update({
          spec: merged,
          // Only `detected` is rewritten; manual branch choices are kept.
          disciplines: { ...(project.disciplines ?? {}), detected: result.analysis.disciplines },
        })
        .eq("id", project.id);
      if (error) throw error;

      // The bill of materials: functions to buy. A pick the client already
      // made carries over to the same line. The basic reader returns none, so
      // it never wipes a list a real analysis produced.
      if (result.analysis.bom.length) {
        const bomSave = await supabase
          .from("projects")
          .update({ bom: mergeBom(project.bom, result.analysis.bom) })
          .eq("id", project.id);
        if (bomSave.error) console.warn("Bill of materials not saved (migration 0023?):", bomSave.error.message);
        else track("bom_generated", { lines: result.analysis.bom.length });
      }

      // Suggested parts become to-design concepts — but only for a discipline
      // that has no to-design parts yet. The model words a part differently
      // each time, so matching names would re-add a concept the client
      // dropped, or duplicate one they kept. A part they touched is never
      // replaced.
      const kinds = new Set(parts.map(disciplineOf).filter(Boolean));
      const have = new Set(parts.map((p) => p.name.trim().toLowerCase()));
      let n = Math.max(0, ...parts.map((p) => parseInt(p.code.replace(/\D/g, ""), 10) || 0));
      const rows = result.analysis.suggestedParts
        // A board to design is the client's choice (the Custom PCB route), never
        // the analysis's, so electronics are not suggested as parts to design.
        .filter((p) => p.kind !== "electronics")
        .filter((p) => !kinds.has(p.kind) && !have.has(p.name.trim().toLowerCase()))
        .map((p) => {
          const s = specFor(p, text);
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

  // A consent-only spec (from the chat) is not an analysis yet.
  const analysed = isAnalysed(spec);
  const current = ANALYSIS_STEPS.find((s) => !done.includes(s));

  return (
    <>
      <Card kicker={t("briefHeading")} title={t("stageTitle_idea")} intro={t("briefIntro")}>
        <BriefEditor
          value={brief}
          onChange={onBriefChange}
          onSave={() => void saveBrief()}
          state={saveState}
          projectId={project.id}
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
        {needsConsent && briefDestination && (
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-[12px] leading-relaxed text-heading">
              <input
                type="checkbox"
                checked={consentTicked}
                onChange={(e) => setConsentTicked(e.target.checked)}
                disabled={running}
                aria-describedby="ai-consent-hint"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cobalt"
              />
              <span id="ai-consent-label">
                {t("aiConsentLabel", { destination: briefDestination })}
              </span>
            </label>
            <p id="ai-consent-hint" className="ps-[1.375rem] text-[11px] text-mutedtext">
              {t("aiConsentHint")}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <BriefChat
            projectId={project.id}
            brief={brief}
            destination={briefDestination}
            consented={!needsConsent}
            onConsent={() => {
              if (briefDestination)
                onSpec({ ...(spec ?? EMPTY_SPEC), aiConsent: { at: new Date().toISOString(), destination: briefDestination } });
            }}
            onAdd={async (text) => void (await addToBrief(text))}
            onAddAndAnalyse={addAndAnalyse}
            // Analyse from inside the chat once the brief is long enough, so the
            // chat never has to be closed first. The analysis re-checks length,
            // schema and consent itself.
            onAnalyse={() => void runAnalysis()}
            canAnalyse={!running && brief.trim().length >= MIN_BRIEF_CHARS}
            analysed={analysed}
            initialOpen={startChat}
          />
          <ReadAloud text={brief} />
          <PrimaryButton
            onClick={() => void runAnalysis()}
            disabled={running || (needsConsent && !consentTicked)}
            // Tells screen-reader users why the button is disabled.
            aria-describedby={
              needsConsent && !consentTicked ? "ai-consent-label ai-consent-hint" : undefined
            }
          >
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
        {consent && (
          <p className="text-[11px] text-mutedtext">
            {t("aiConsentGiven", { date: formatConsentDate(consent.at, locale) })}
          </p>
        )}

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

      <UnderstoodPanel spec={spec} brief={savedBrief} running={running} onChange={onSpec} />
    </>
  );
}

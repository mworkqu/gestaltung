"use client";

// "What we understood" and "Needs your input" in one list (owner, 2026-09-29),
// colour-coded so it's easy to decide:
//   blue   — needs your answer (only questions that change the plan)
//   amber  — we guessed: tap ✓ if right, or change it
//   green  — settled: from your brief or your answer
//   grey   — optional details that won't change the plan, folded away with
//            "Skip all"
// Every answer goes through setFact(), exactly as the old sheet did.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, RotateCcw } from "lucide-react";

import { STANDARD_FACTS, briefStates, isStandardFact } from "@/lib/prototyping/analysis";
import { factFocus, factLabel } from "@/lib/prototyping/readiness";
import { isAnalysed, keptAnswer, rowOf, setFact, type Spec, type SpecRow } from "@/lib/prototyping/spec";
import { Tag } from "@/components/ui/tag";
import { Card, PrimaryButton } from "@/components/prototyping/ui";
import { FactControl, controlType, formatFact } from "@/components/prototyping/spec-sheet";
import { ReadAloud } from "@/components/prototyping/read-aloud";
import { cn } from "@/lib/utils";

type Tone = "ask" | "guess" | "done" | "optional";

const TONE: Record<Tone, string> = {
  ask: "border-s-4 border-cobalt bg-cobalt/5",
  guess: "border-s-4 border-amber-400 bg-amber-50/70",
  done: "border-s-4 border-emerald-500 bg-emerald-50/60",
  optional: "border-s-4 border-borderstrong bg-panel/60",
};

/** One-tap answers: option chips (or a field for numbers/text) plus "Skip". */
function Chips({
  id,
  type,
  options,
  onPick,
}: {
  id: string;
  type: "number" | "select" | "boolean" | "text";
  options?: string[];
  onPick: (v: string | null) => void;
}) {
  const t = useTranslations("Prototyping");
  const opts = type === "boolean" ? ["yes", "no"] : type === "select" ? options ?? [] : [];
  const chip = "rounded-full bg-surface px-3 py-1.5 text-[12px] font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opts.length > 0 ? (
        opts.map((o) => (
          <button key={o} type="button" onClick={() => onPick(o)} className={chip}>
            {formatFact(id, o, t)}
          </button>
        ))
      ) : (
        <span className="min-w-0 flex-1 basis-48">
          <FactControl id={id} domId={factFocus(id)} label={id} type={type === "number" ? "number" : "text"} value={undefined} onCommit={onPick} />
        </span>
      )}
      <button type="button" onClick={() => onPick(null)} className={cn(chip, "font-medium text-mutedtext")}>
        {t("skipQuestion")}
      </button>
    </div>
  );
}

export function UnderstoodPanel({
  spec,
  brief,
  running,
  onChange,
}: {
  spec: Spec | null;
  /** The saved brief, to check each "from your brief" against. */
  brief?: string;
  running: boolean;
  onChange: (next: Spec) => void;
}) {
  const t = useTranslations("Prototyping");
  const [editing, setEditing] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);

  if (running) {
    return (
      <Card kicker={t("claimsHeading")} title={t("understoodTitle")}>
        <ul className="space-y-2" aria-busy="true" aria-label={t("analysing")}>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-10 animate-pulse rounded-xl bg-borderstrong/30" />
          ))}
        </ul>
      </Card>
    );
  }
  // Nothing read yet (null, or only the AI consent from the chat).
  if (!isAnalysed(spec)) return null;

  const questions = spec.questions ?? [];
  const answered = (id: string) => !!rowOf(spec, id)?.edited;
  const ask = questions.filter((q) => isStandardFact(q.id) && !answered(q.id));
  const optional = questions.filter((q) => !isStandardFact(q.id) && !answered(q.id));
  const openIds = new Set([...ask, ...optional].map((q) => q.id));
  const rows = spec.rows.filter((r) => !openIds.has(r.id));
  const fromBrief = (r: SpecRow) =>
    r.source === "brief" && (brief === undefined || (r.value !== null && briefStates(r.id, r.value, brief)));
  const guesses = rows.filter((r) => !r.edited && !fromBrief(r));
  const settled = rows.filter((r) => r.edited || fromBrief(r));
  const set = (fact: { id: string; label: string }, v: string | null) => onChange(setFact(spec, fact, v));

  const readText = [
    spec.summary,
    ...settled.map((r) => `${factLabel(r.id, r.label, t)}: ${formatFact(r.id, r.value, t)}.`),
    ...guesses.map((r) => `${factLabel(r.id, r.label, t)}: ${formatFact(r.id, r.value, t)}?`),
    ...ask.map((q) => `${factLabel(q.id, q.label, t)}?`),
  ]
    .filter(Boolean)
    .join(" ");

  const editRow = (r: SpecRow) => (
    <FactControl
      id={r.id}
      label={factLabel(r.id, r.label, t)}
      type={controlType(r)}
      options={
        isStandardFact(r.id) && "options" in STANDARD_FACTS[r.id]
          ? [...(STANDARD_FACTS[r.id] as { options: readonly string[] }).options]
          : undefined
      }
      value={r.value}
      autoFocus
      onCommit={(v) => {
        setEditing(null);
        set(r, v);
      }}
    />
  );

  return (
    <Card kicker={t("claimsHeading")} title={t("understoodTitle")} intro={t("understoodIntro")} actions={<ReadAloud text={readText} />}>
      {spec.summary && <p className="max-w-[68ch] text-sm leading-relaxed text-heading">{spec.summary}</p>}

      <div className="flex flex-wrap gap-3 text-[11px] text-mutedtext">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-cobalt" />
          {t("legendAsk")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          {t("legendGuess")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          {t("legendDone")}
        </span>
      </div>

      <ul className="space-y-2">
        {ask.map((q) => (
          <li key={q.id} id={factFocus(q.id)} tabIndex={-1} className={cn("space-y-2 rounded-xl p-3 outline-none", TONE.ask)}>
            <p className="text-[12.5px] font-bold text-heading">{factLabel(q.id, q.label, t)}</p>
            <Chips id={q.id} type={q.type} options={q.options} onPick={(v) => set(q, v)} />
          </li>
        ))}

        {guesses.map((r) => (
          <li key={r.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl p-3", TONE.guess)}>
            <span className="min-w-0 flex-1 text-[12.5px]">
              <span className="font-bold text-heading">{factLabel(r.id, r.label, t)}:</span>{" "}
              {editing === r.id ? editRow(r) : <span className="text-heading">{formatFact(r.id, r.value, t)}</span>}
              <span className="ms-2 text-[10.5px] font-medium text-amber-800">{t("weGuessed")}</span>
            </span>
            {editing !== r.id && (
              <span className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => set(r, r.value)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-emerald-700 shadow-neu-sm"
                >
                  <Check className="h-3 w-3" />
                  {t("guessRight")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(r.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-heading shadow-neu-sm"
                >
                  <Pencil className="h-3 w-3" />
                  {t("guessChange")}
                </button>
              </span>
            )}
          </li>
        ))}

        {settled.map((r) => (
          <li key={r.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2", TONE.done)}>
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 text-[12.5px]">
              <span className="font-semibold text-heading">{factLabel(r.id, r.label, t)}:</span>{" "}
              {editing === r.id ? (
                editRow(r)
              ) : (
                <button type="button" onClick={() => setEditing(r.id)} className="text-heading hover:text-cobalt">
                  {formatFact(r.id, r.value, t)}
                </button>
              )}
            </span>
            {keptAnswer(r) && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-inventory">
                <RotateCcw className="h-3 w-3" />
                {t("keptYourAnswer")}
              </span>
            )}
          </li>
        ))}
      </ul>

      {optional.length > 0 && (
        <div className={cn("space-y-2 rounded-xl p-3", TONE.optional)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowOptional((s) => !s)}
              aria-expanded={showOptional}
              className="text-[12.5px] font-semibold text-heading"
            >
              {t("optionalQuestions", { count: optional.length })}
            </button>
            <button
              type="button"
              onClick={() => onChange(optional.reduce((acc, q) => setFact(acc, q, null), spec))}
              className="rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-mutedtext shadow-neu-sm hover:text-heading"
            >
              {t("skipAll")}
            </button>
          </div>
          <p className="text-[11px] text-mutedtext">{t("optionalHint")}</p>
          {showOptional &&
            optional.map((q) => (
              <div key={q.id} className="space-y-1.5 pt-1">
                <p className="text-[12px] font-semibold text-heading">{factLabel(q.id, q.label, t)}</p>
                <Chips id={q.id} type={q.type} options={q.options} onPick={(v) => set(q, v)} />
              </div>
            ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-borderstrong/40 pt-4">
          {spec.confirmed ? (
            <Tag variant="buy">
              <Check className="h-3 w-3" />
              {t("specConfirmed")}
            </Tag>
          ) : (
            <PrimaryButton
              // "Looks right" also accepts every remaining guess.
              onClick={() => onChange({ ...guesses.reduce((acc, r) => setFact(acc, r, r.value), spec), confirmed: true })}
            >
              <Check className="h-3.5 w-3.5" />
              {t("looksRight")}
            </PrimaryButton>
          )}
          {ask.length > 0 && <span className="text-[11px] font-medium text-cobalt">{t("stillToAnswer", { count: ask.length })}</span>}
        </div>
      )}
    </Card>
  );
}

"use client";

// "What we understood" and "Needs your input".
//
// The spec sheet is a compact table: one fact per row, its value (editable in
// place) and where it came from. No per-row confirm and no percentages — one
// action under the table confirms the whole block. The questions below it are
// real controls, and every one accepts "not decided yet" as an answer.
// Both write through setFact(), so answering a question shows up in the table
// immediately.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, RotateCcw } from "lucide-react";

import { STANDARD_FACTS, isStandardFact, type Question } from "@/lib/prototyping/analysis";
import { factFocus, factLabel, type Translate } from "@/lib/prototyping/readiness";
import { keptAnswer, rowOf, setFact, type Spec, type SpecRow } from "@/lib/prototyping/spec";
import { Tag } from "@/components/ui/tag";
import { Card, PrimaryButton, selectClass } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";

const UNDECIDED = "__undecided";

/** How a stored value reads on screen. */
export function formatFact(id: string, value: string | null, t: Translate): string {
  if (value === null) return t("notDecided");
  if (isStandardFact(id) && "options" in STANDARD_FACTS[id]) return t(`opt_${id}_${value}`);
  if (value === "yes" || value === "no") return t(value);
  return value;
}

/** The control for a fact: a select for options, a number field, or text. */
function FactControl({
  id,
  domId,
  label,
  type,
  options,
  value,
  onCommit,
  autoFocus,
}: {
  id: string;
  domId?: string;
  label: string;
  type: "number" | "select" | "boolean" | "text";
  options?: string[];
  value: string | null | undefined;
  onCommit: (value: string | null) => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations("Prototyping");
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);

  if (type === "select" || type === "boolean") {
    const opts = type === "boolean" ? ["yes", "no"] : options ?? [];
    return (
      <select
        id={domId}
        aria-label={label}
        autoFocus={autoFocus}
        value={value === null ? UNDECIDED : value ?? ""}
        onChange={(e) => onCommit(e.target.value === UNDECIDED ? null : e.target.value)}
        className={cn(selectClass, "w-full min-w-0")}
      >
        {value === undefined && <option value="">{t("choose")}</option>}
        {opts.map((o) => (
          <option key={o} value={o}>
            {formatFact(id, o, t)}
          </option>
        ))}
        <option value={UNDECIDED}>{t("notDecided")}</option>
      </select>
    );
  }

  const commit = () => {
    const v = draft.trim();
    if (!v || v === value) return;
    if (type === "number" && !(Number(v) > 0 && Number.isInteger(Number(v)))) return;
    onCommit(v);
  };
  return (
    <span className="flex min-w-0 items-center gap-2">
      <input
        id={domId}
        aria-label={label}
        autoFocus={autoFocus}
        type={type === "number" ? "number" : "text"}
        inputMode={type === "number" ? "numeric" : undefined}
        min={type === "number" ? 1 : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className={cn(selectClass, "w-full min-w-0", type === "number" && "max-w-32")}
      />
      {type === "number" && (
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-mutedtext">
          <input
            type="checkbox"
            checked={value === null}
            onChange={(e) => onCommit(e.target.checked ? null : draft.trim() || null)}
          />
          {t("notDecided")}
        </label>
      )}
    </span>
  );
}

function controlType(row: { id: string }): "number" | "select" | "text" {
  if (!isStandardFact(row.id)) return "text";
  return STANDARD_FACTS[row.id].type === "number" ? "number" : "select";
}

function SourceTag({ row }: { row: SpecRow }) {
  const t = useTranslations("Prototyping");
  if (row.source === "you") return <Tag variant="inventory">{t("sourceYou")}</Tag>;
  if (row.source === "assumed") return <Tag variant="neutral">{t("sourceAssumed")}</Tag>;
  return <Tag variant="buy">{t("sourceBrief")}</Tag>;
}

export function SpecSheet({
  spec,
  running,
  onChange,
}: {
  spec: Spec | null;
  running: boolean;
  onChange: (next: Spec) => void;
}) {
  const t = useTranslations("Prototyping");
  const [editing, setEditing] = useState<string | null>(null);
  const rows = spec?.rows ?? [];

  return (
    <Card kicker={t("claimsHeading")} title={t("claimsHeading")} intro={t("specIntro")}>
      {!running && spec?.summary && (
        <p className="max-w-[68ch] text-sm leading-relaxed text-heading">{spec.summary}</p>
      )}

      {running ? (
        <ul className="space-y-2" aria-busy="true" aria-label={t("analysing")}>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-3 shadow-neu-sm">
              <span className="h-3 w-28 animate-pulse rounded bg-borderstrong/50" />
              <span className="h-3 flex-1 animate-pulse rounded bg-borderstrong/40" />
              <span className="h-4 w-16 animate-pulse rounded-full bg-borderstrong/40" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("noSpec")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className="px-3 pb-2 text-start font-medium">{t("colFact")}</th>
                <th className="px-3 pb-2 text-start font-medium">{t("colValue")}</th>
                <th className="px-3 pb-2 text-start font-medium">{t("colSource")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borderstrong/40">
              {rows.map((row) => {
                const label = factLabel(row.id, row.label, t);
                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2.5 text-[12.5px] font-semibold text-heading">{label}</td>
                    <td className="px-3 py-2.5">
                      {editing === row.id ? (
                        <FactControl
                          id={row.id}
                          label={label}
                          type={controlType(row)}
                          options={
                            isStandardFact(row.id) && "options" in STANDARD_FACTS[row.id]
                              ? [...(STANDARD_FACTS[row.id] as { options: readonly string[] }).options]
                              : undefined
                          }
                          value={row.value}
                          autoFocus
                          onCommit={(v) => {
                            setEditing(null);
                            onChange(setFact(spec!, row, v));
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(row.id)}
                          className="group inline-flex max-w-full items-start gap-1.5 text-start text-[12.5px] text-heading hover:text-cobalt"
                        >
                          <span className={cn(row.value === null && "text-mutedtext")}>
                            {formatFact(row.id, row.value, t)}
                          </span>
                          <Pencil className="mt-0.5 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <SourceTag row={row} />
                        {keptAnswer(row) && (
                          <span
                            className="inline-flex items-center gap-1 text-[10.5px] font-medium text-inventory"
                            title={t("analysisRead", { value: formatFact(row.id, row.analysisValue!, t) })}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("keptYourAnswer")}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!running && spec && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-borderstrong/40 pt-4">
          {spec.confirmed ? (
            <Tag variant="buy">
              <Check className="h-3 w-3" />
              {t("specConfirmed")}
            </Tag>
          ) : (
            <PrimaryButton onClick={() => onChange({ ...spec, confirmed: true })}>
              <Check className="h-3.5 w-3.5" />
              {t("confirmSpec")}
            </PrimaryButton>
          )}
          <span className="text-[11px] text-mutedtext">{t("specEditHint")}</span>
        </div>
      )}
    </Card>
  );
}

export function NeedsInput({
  spec,
  onChange,
}: {
  spec: Spec | null;
  onChange: (next: Spec) => void;
}) {
  const t = useTranslations("Prototyping");
  const questions: Question[] = spec?.questions ?? [];
  if (!spec || !questions.length) return null;

  return (
    <Card kicker={t("inputsHeading")} title={t("inputsHeading")} intro={t("inputsIntro")}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {questions.map((q) => {
          const label = factLabel(q.id, q.label, t);
          const row = rowOf(spec, q.id);
          const answered = !!row?.edited;
          return (
            <li key={q.id} className="space-y-1.5 rounded-xl bg-panel p-3 shadow-neu-sm">
              <label htmlFor={factFocus(q.id)} className="flex items-center gap-2 text-xs font-semibold text-heading">
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full",
                    answered ? "bg-buy-bg text-buy" : "bg-surface shadow-neu-sm"
                  )}
                >
                  {answered && <Check className="h-2.5 w-2.5" />}
                </span>
                {label}
              </label>
              <FactControl
                id={q.id}
                domId={factFocus(q.id)}
                label={label}
                type={q.type}
                options={q.options}
                value={answered ? row!.value : undefined}
                onCommit={(v) => onChange(setFact(spec, { id: q.id, label: q.label }, v))}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

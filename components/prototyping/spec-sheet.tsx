"use client";

// The controls behind "What we understood" (components/prototyping/
// understood-panel.tsx): how a fact reads, and the field that edits it. Every
// control accepts "not decided yet" as an answer.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { STANDARD_FACTS, isStandardFact } from "@/lib/prototyping/analysis";
import type { Translate } from "@/lib/prototyping/readiness";
import { selectClass } from "@/components/prototyping/ui";
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
export function FactControl({
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
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

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

export function controlType(row: { id: string }): "number" | "select" | "text" {
  if (!isStandardFact(row.id)) return "text";
  return STANDARD_FACTS[row.id].type === "number" ? "number" : "select";
}

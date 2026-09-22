"use client";

// The brief editor: the most important input on the page, so it gets room.
//
// Plain text only. It grows with its content from a 12-row minimum and only
// shows its own scrollbar once the text is taller than most of the viewport.
// It saves when it loses focus; the parent owns the save so the analysis can
// flush it first. The toolbar above it takes dictation (./dictation): spoken
// words arrive as ordinary text, and the editor is read-only only while live
// words are still streaming in.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CircleAlert, Loader2 } from "lucide-react";

import { MAX_BRIEF_CHARS } from "@/lib/prototyping/constants";
import { wordCount } from "@/lib/prototyping/readiness";
import { Dictation } from "@/components/prototyping/dictation";
import { fieldClass } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

const MIN_ROWS = 12;
/** Past this share of the viewport the editor scrolls instead of growing. */
const MAX_VIEWPORT_SHARE = 0.7;

export function BriefEditor({
  value,
  onChange,
  onSave,
  state,
  projectId,
}: {
  projectId?: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  state: SaveState;
}) {
  const t = useTranslations("Prototyping");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dictating, setDictating] = useState(false);
  const onBusy = useCallback((b: boolean) => setDictating(b), []);

  // Dictated text lands in the editor for the client to read and fix, so put
  // the cursor at its end. Leaving the editor then saves it like typing does.
  const focusEnd = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto"; // collapse to `rows`, then measure the content
    const max = window.innerHeight * MAX_VIEWPORT_SHARE;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  return (
    <div className="space-y-2">
      <Dictation
        value={value}
        onChange={(v) => onChange(v.slice(0, MAX_BRIEF_CHARS))}
        onBusy={onBusy}
        onDone={focusEnd}
        projectId={projectId}
      />
      <textarea
        ref={ref}
        id="brief-editor"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_BRIEF_CHARS))}
        onBlur={onSave}
        readOnly={dictating}
        aria-busy={dictating}
        rows={MIN_ROWS}
        placeholder={t("briefPlaceholder")}
        aria-label={t("briefHeading")}
        className={cn(fieldClass, "resize-none overflow-hidden")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-mutedtext">
        <span className="tabular-nums">{t("wordCount", { count: wordCount(value) })}</span>
        <span aria-live="polite" className="inline-flex items-center gap-1.5">
          {state === "dirty" && t("unsaved")}
          {state === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("saving")}
            </>
          )}
          {state === "saved" && (
            <>
              <Check className="h-3 w-3 text-buy" />
              <span className="text-buy">{t("saved")}</span>
            </>
          )}
          {state === "error" && (
            <button
              type="button"
              onClick={onSave}
              className="inline-flex items-center gap-1 font-semibold text-destructive"
            >
              <CircleAlert className="h-3 w-3" />
              {t("saveFailed")}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

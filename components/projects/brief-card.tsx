"use client";

// The project brief editor (split out of project-workspace.tsx, R8).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/supabase/types";

// ── Brief ───────────────────────────────────────────────────────────────────
// One brief per project (audit #19): this edits projects.brief, the same field
// the prototyping Brief stage reads and writes. projects.notes is no longer
// shown (0033 copies notes into an empty brief).

export function BriefCard({ project }: { project: Project }) {
  const t = useTranslations("Projects");
  const [brief, setBrief] = useState(project.brief ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text instead of scrolling inside a fixed box.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [brief]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onChange(value: string) {
    setBrief(value);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await createClient()
        .from("projects")
        .update({ brief: value.trim() ? value : null })
        .eq("id", project.id);
      setStatus(error ? "error" : "saved");
    }, 700);
  }

  return (
    <section className="neu space-y-3 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-heading">
          <label htmlFor="project-brief">{t("briefHeading")}</label>
        </h2>
        {status !== "idle" && (
          <span
            role={status === "error" ? "alert" : undefined}
            className={cn(
              "text-[11px]",
              status === "error" ? "font-medium text-destructive" : "text-mutedtext"
            )}
          >
            {status === "saving" ? t("saving") : status === "saved" ? t("saved") : t("saveFailed")}
          </span>
        )}
      </div>
      <p className="text-sm text-mutedtext">{t("briefHint")}</p>
      <textarea
        id="project-brief"
        ref={areaRef}
        value={brief}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={t("briefPlaceholder")}
        className="min-h-[7rem] w-full resize-none overflow-hidden rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm leading-relaxed text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
      />
    </section>
  );
}

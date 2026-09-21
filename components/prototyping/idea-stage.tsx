"use client";

// Idea stage: the brief, and what the rules engine read out of it.
//
// The analysis is a local, synchronous function call — no network, no model,
// no cost. It writes claims and suggested parts as rows the client then
// confirms or corrects; it never edits anything the client already settled.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Pencil, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { analyse } from "@/lib/prototyping/engine";
import { MAX_BRIEF_CHARS } from "@/lib/prototyping/constants";
import { Tag } from "@/components/ui/tag";
import {
  Card,
  Confidence,
  GhostButton,
  PrimaryButton,
  SoftButton,
  fieldClass,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectClaim } from "@/lib/supabase/types";

export function IdeaStage({
  project,
  claims,
  onChanged,
}: {
  project: Project;
  claims: ProjectClaim[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const [brief, setBrief] = useState(project.brief ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onBriefChange(value: string) {
    setBrief(value.slice(0, MAX_BRIEF_CHARS));
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await createClient()
        .from("projects")
        .update({ brief: value })
        .eq("id", project.id);
      setStatus("saved");
    }, 700);
  }

  // Runs the engine and writes what it found. Anything the client has already
  // confirmed, corrected or edited survives untouched — re-analysing must
  // never quietly undo a decision they made.
  async function runAnalysis() {
    if (brief.trim().length < 40) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setFailed(false);
    setBusy(true);
    const supabase = createClient();

    // Every write is checked: a half-written analysis that looks finished is
    // worse than a clear "that didn't save".
    const must = <T extends { error: unknown }>(res: T): T => {
      if (res.error) throw res.error;
      return res;
    };

    try {
      // Flush any pending brief save first, so the analysis reads what's on screen.
      if (timer.current) clearTimeout(timer.current);
      must(
        await supabase.from("projects").update({ brief }).eq("id", project.id),
      );

      const { claims: found, parts: suggested } = analyse(brief);

      must(
        await supabase
          .from("project_claims")
          .delete()
          .eq("project_id", project.id)
          .eq("status", "pending"),
      );

      const settled = new Set(
        claims.filter((c) => c.status !== "pending").map((c) => c.text),
      );
      const rows = found
        .map((c, i) => ({
          project_id: project.id,
          text: t(`claim_${c.key}`, c.params ?? {}),
          confidence: c.confidence,
          is_assumption: c.isAssumption ?? false,
          position: i,
        }))
        .filter((r) => !settled.has(r.text));
      if (rows.length) must(await supabase.from("project_claims").insert(rows));

      // Parts: only add ones that aren't there. A part the client touched keeps
      // its material, process and status.
      const { data: existing } = must(
        await supabase
          .from("project_parts")
          .select("code, name")
          .eq("project_id", project.id),
      );
      const have = new Set((existing ?? []).map((p) => p.name as string));
      let n = (existing ?? []).length;
      const partRows = suggested
        .map((p) => ({
          project_id: project.id,
          name: t(`part_${p.key}_name`),
          description: t(`part_${p.key}_desc`),
          quantity: p.quantity,
          material: p.material,
          process: p.process,
          ai_material: p.material,
          ai_process: p.process,
          confidence: p.confidence,
          status: "suggested" as const,
        }))
        .filter((p) => !have.has(p.name))
        .map((p) => ({
          ...p,
          code: `P-${String(++n).padStart(2, "0")}`,
          position: n,
        }));
      if (partRows.length)
        must(await supabase.from("project_parts").insert(partRows));

      // The idea is under way and parts now exist to confirm.
      const stages = { ...project.stages, idea: "progress", parts: "needs" };
      must(
        await supabase.from("projects").update({ stages }).eq("id", project.id),
      );
      setStatus("saved");
    } catch {
      setFailed(true);
    }

    await onChanged();
    setBusy(false);
  }

  const analysed = claims.length > 0;

  return (
    <>
      <Card
        kicker={t("briefHeading")}
        title={t("stageTitle_idea")}
        intro={t("briefIntro")}
        actions={
          status !== "idle" && (
            <span className="text-[11px] text-mutedtext">
              {status === "saving" ? t("saving") : t("saved")}
            </span>
          )
        }
      >
        <textarea
          value={brief}
          onChange={(e) => onBriefChange(e.target.value)}
          rows={8}
          placeholder={t("briefPlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
        {tooShort && (
          <p className="text-xs font-medium text-destructive">
            {t("briefTooShort")}
          </p>
        )}
        {failed && (
          <p className="text-xs font-medium text-destructive">
            {t("analyseFailed")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton onClick={runAnalysis} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {busy ? t("analysing") : analysed ? t("reanalyse") : t("analyse")}
          </PrimaryButton>
          <span className="text-[11px] text-mutedtext">
            {analysed ? t("reanalyseWarn") : t("nothingApplied")}
          </span>
        </div>
      </Card>

      <ClaimsCard claims={claims} onChanged={onChanged} />
    </>
  );
}

function ClaimsCard({
  claims,
  onChanged,
}: {
  claims: ProjectClaim[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = claims.filter((c) => c.status === "pending");

  async function setStatus(id: string, patch: Partial<ProjectClaim>) {
    setBusy(true);
    await createClient().from("project_claims").update(patch).eq("id", id);
    await onChanged();
    setBusy(false);
  }

  async function confirmAll() {
    setBusy(true);
    const supabase = createClient();
    await Promise.all(
      pending.map((c) =>
        supabase
          .from("project_claims")
          .update({ status: "confirmed" })
          .eq("id", c.id),
      ),
    );
    await onChanged();
    setBusy(false);
  }

  async function saveCorrection(c: ProjectClaim) {
    const text = draft.trim();
    setEditing(null);
    if (!text || text === c.text) return;
    await setStatus(c.id, {
      text,
      status: "corrected",
      source: "user",
      original_text: c.original_text ?? c.text,
    });
  }

  return (
    <Card
      kicker={t("claimsHeading")}
      title={t("claimsHeading")}
      intro={t("claimsIntro")}
      actions={
        pending.length > 0 && (
          <SoftButton onClick={confirmAll} disabled={busy}>
            <Check className="h-3.5 w-3.5" />
            {t("confirmAll")}
          </SoftButton>
        )
      }
    >
      {claims.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("noClaims")}</p>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => (
            <li
              key={c.id}
              className="rounded-xl bg-panel p-3 shadow-neu-sm sm:p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                    c.status === "confirmed"
                      ? "bg-buy-bg text-buy"
                      : c.status === "corrected"
                        ? "bg-inventory-bg text-inventory"
                        : "bg-surface text-cobalt shadow-neu-sm",
                  )}
                >
                  {c.status === "confirmed" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : c.status === "corrected" ? (
                    <Pencil className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  {editing === c.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveCorrection(c);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        autoFocus
                        className={cn(fieldClass, "flex-1 py-2 text-sm")}
                      />
                      <PrimaryButton onClick={() => saveCorrection(c)}>
                        {t("save")}
                      </PrimaryButton>
                      <GhostButton onClick={() => setEditing(null)}>
                        {t("cancel")}
                      </GhostButton>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-heading">
                      {c.text}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {c.is_assumption && c.status === "pending" && (
                      <Tag variant="inventory">{t("assumptionTag")}</Tag>
                    )}
                    {c.status === "confirmed" && (
                      <Tag variant="buy">{t("confirmedTag")}</Tag>
                    )}
                    {c.status === "corrected" && (
                      <>
                        <Tag variant="inventory">{t("correctedTag")}</Tag>
                        {c.original_text && (
                          <span className="text-[11px] text-faint line-through">
                            {t("wasRead", { text: c.original_text })}
                          </span>
                        )}
                      </>
                    )}
                    {c.status === "pending" && (
                      <Confidence
                        value={c.confidence}
                        label={t("confidence")}
                      />
                    )}
                  </div>
                </div>

                {editing !== c.id && (
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    {c.status !== "confirmed" && (
                      <SoftButton
                        onClick={() => setStatus(c.id, { status: "confirmed" })}
                        disabled={busy}
                        className="bg-surface"
                      >
                        <Check className="h-3 w-3" />
                        {t("confirm")}
                      </SoftButton>
                    )}
                    <GhostButton
                      onClick={() => {
                        setEditing(c.id);
                        setDraft(c.text);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      {t("correct")}
                    </GhostButton>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-faint">{t("nothingApplied")}</p>
    </Card>
  );
}

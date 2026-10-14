"use client";

import * as React from "react";
import Link from "next/link";
import { Award, CheckCircle2, CircleAlert, Lightbulb, Lock, PartyPopper, PlayCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, HelpTip, Spinner, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatNumber } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";
import { gradeExerciseAction, revealHintAction, type GradeExerciseResult } from "@/lib/cad-champions/training/actions";
import { SOLUTION_AFTER_ATTEMPTS, attemptsUntilSolution } from "@/lib/cad-champions/training/access";
import { cn } from "@/lib/utils";

const KNOWN_CHECKS = new Set(["volume", "surface_area", "principal_moments", "solid_count_validity", "units", "parts_count", "assembly_position"]);

type Ok = Extract<GradeExerciseResult, { ok: true }>;
type View =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; r: Ok }
  | { kind: "unavailable"; file: UploadedFile }
  | { kind: "error"; message: string };

export interface ExerciseInitial {
  best: number | null;
  attempts: number;
  failed: number;
  passed: boolean;
  hintsAvailable: number;
  solutionUnlocked: boolean;
}

export function ExerciseWorkspace({
  slug,
  exerciseId,
  userId,
  accept,
  passMark,
  hintCount,
  hasSolution,
  stepHelpSlug,
  initial,
}: {
  slug: string;
  exerciseId: string;
  userId: string;
  accept: "step" | "pdf";
  passMark: number;
  hintCount: number;
  hasSolution: boolean;
  stepHelpSlug?: string;
  initial: ExerciseInitial;
}) {
  const t = useTranslations("CC.training.exercise");
  const th = useTranslations("CC.training.hints");
  const ts = useTranslations("CC.training.solution");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = React.useState<View>({ kind: "idle" });
  const [hintsOpen, setHintsOpen] = React.useState(initial.hintsAvailable);
  const [attempts, setAttempts] = React.useState(initial.attempts);
  const [passed, setPassed] = React.useState(initial.passed);
  const [solutionOpen, setSolutionOpen] = React.useState(initial.solutionUnlocked);
  const [hints, setHints] = React.useState<Record<number, string>>({});
  const [hintBusy, setHintBusy] = React.useState<number | null>(null);
  const [solution, setSolution] = React.useState<{ state: "idle" | "loading" | "error" } | { state: "ready"; url: string }>({ state: "idle" });

  const pct = (n: number | null) => (n == null ? "" : formatNumber(Math.round(n), locale));

  async function grade(file: UploadedFile) {
    setView({ kind: "checking" });
    try {
      const r = await gradeExerciseAction({ slug, path: file.path, fileName: file.fileName, size: file.size, sha256: file.sha256, locale });
      if (!r.ok) {
        if (r.reason === "unavailable") setView({ kind: "unavailable", file });
        else {
          const key = r.reason === "forbidden" || r.reason === "locked" || r.reason === "bad_file" ? r.reason : "error";
          setView({ kind: "error", message: t(`errors.${key}`) });
        }
        return;
      }
      setView({ kind: "result", r });
      setHintsOpen(r.hintsAvailable);
      setSolutionOpen(r.solutionUnlocked);
      if (r.outcome === "passed" || r.outcome === "failed") setAttempts((a) => a + 1);
      if (r.outcome === "passed") {
        setPassed(true);
        toast.success(t("passedTitle", { percent: pct(r.percent) }));
      }
      router.refresh();
    } catch (e) {
      console.error("[cc-exercise] grade failed:", e instanceof Error ? e.message : e);
      setView({ kind: "error", message: t("errors.error") });
    }
  }

  async function reveal(n: number) {
    setHintBusy(n);
    try {
      const r = await revealHintAction({ slug, n, locale });
      if (r.ok) setHints((h) => ({ ...h, [n]: r.text }));
      else toast.error(th("error"));
    } catch {
      toast.error(th("error"));
    } finally {
      setHintBusy(null);
    }
  }

  async function openSolution() {
    setSolution({ state: "loading" });
    try {
      const res = await fetch(`/api/cad-champions/video/${encodeURIComponent(`solution:${slug}`)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { embedUrl?: string };
      setSolution(res.ok && body.embedUrl ? { state: "ready", url: body.embedUrl } : { state: "error" });
    } catch {
      setSolution({ state: "error" });
    }
  }

  const checking = view.kind === "checking";

  return (
    <div className="space-y-6">
      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby={`up-${exerciseId}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`up-${exerciseId}`} className="title-section">
            {t("uploadTitle")}
          </h2>
          <span className="text-sm font-semibold text-body">{t("unlimited")}</span>
        </div>
        <UploadBox
          accept={accept}
          bucket="cc-submissions"
          pathPrefix={`${userId}/exercises/${exerciseId}/`}
          label={accept === "pdf" ? t("uploadPdf") : t("uploadStep")}
          onUploaded={(f) => void grade(f)}
          disabled={checking}
          stepHelpSlug={stepHelpSlug}
        />
        {checking ? <Spinner label={t("checking")} /> : null}

        {view.kind === "result" ? renderResult(view.r, locale) : null}

        {view.kind === "unavailable" ? (
          <Alert
            tone="warning"
            title={t("unavailableTitle")}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => void grade(view.file)}>
                {t("retry")}
              </Button>
            }
          >
            {t("unavailableText")}
          </Alert>
        ) : null}
        {view.kind === "error" ? <Alert tone="error" title={view.message} /> : null}
      </section>

      {/* Hints */}
      <section className="neu space-y-3 p-6" aria-labelledby={`hints-${exerciseId}`}>
        <div className="flex items-center gap-2">
          <Lightbulb aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id={`hints-${exerciseId}`} className="title-card">
            {th("title")}
          </h2>
          <HelpTip label={th("helpLabel")}>{th("help")}</HelpTip>
        </div>
        {hintCount === 0 ? (
          <p className="text-sm text-body">{th("none")}</p>
        ) : (
          <ol className="space-y-2">
            {Array.from({ length: Math.min(hintCount, 3) }, (_, i) => i + 1).map((n) => (
              <li key={n} className="tile space-y-2">
                {hints[n] ? (
                  <p className="text-sm text-ink">
                    <span className="font-bold" dir="ltr">{n}. </span>
                    {hints[n]}
                  </p>
                ) : n <= hintsOpen ? (
                  <Button type="button" variant="secondary" size="sm" loading={hintBusy === n} loadingText={th("revealing")} onClick={() => void reveal(n)}>
                    {th("reveal", { n: String(n) })}
                  </Button>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-body">
                    <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
                    {th("lockedHint", { n: String(n) })}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Solution video */}
      <section className="neu space-y-3 p-6" aria-labelledby={`sol-${exerciseId}`}>
        <div className="flex items-center gap-2">
          <PlayCircle aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id={`sol-${exerciseId}`} className="title-card">
            {ts("title")}
          </h2>
        </div>
        {!hasSolution ? (
          <p className="text-sm text-body">{ts("none")}</p>
        ) : !solutionOpen ? (
          <p className="flex items-center gap-2 text-sm text-body">
            <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
            {ts("locked", { left: formatNumber(attemptsUntilSolution(passed, Math.min(attempts, SOLUTION_AFTER_ATTEMPTS)), locale) })}
          </p>
        ) : solution.state === "ready" ? (
          <div className="neu-inset relative aspect-video w-full overflow-hidden rounded-2xl">
            <iframe
              src={solution.url}
              title={ts("title")}
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Button type="button" loading={solution.state === "loading"} loadingText={ts("loading")} onClick={() => void openSolution()}>
              {ts("open")}
            </Button>
            {solution.state === "error" ? (
              <p role="alert" className="text-sm font-semibold text-[#a1231f]">
                {ts("error")}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );

  function renderResult(r: Ok, l: Locale) {
    if (r.outcome === "review" || r.outcome === "saved") {
      return (
        <Alert tone="info" title={r.outcome === "review" ? t("reviewTitle") : t("savedTitle")}>
          {r.outcome === "review" ? t("reviewText") : t("savedText")}
        </Alert>
      );
    }
    const ok = r.outcome === "passed";
    return (
      <div role="status" className={cn("space-y-3 rounded-2xl border p-4", ok ? "border-buy/20 bg-buy-bg" : "border-inventory/20 bg-inventory-bg")}>
        <div className="flex items-start gap-3">
          {ok ? (
            <PartyPopper aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-6 w-6 shrink-0 text-buy rtl:-scale-x-100" />
          ) : (
            <CircleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-6 w-6 shrink-0 text-inventory" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-base font-extrabold text-ink">{ok ? t("passedTitle", { percent: pct(r.percent) }) : t("failedTitle", { percent: pct(r.percent) })}</p>
            <p className="text-sm text-body">{ok ? t("passedText", { best: pct(r.best) }) : t("failedText", { passMark: formatNumber(passMark, l) })}</p>
            {r.message ? <p className="text-sm text-ink">{r.message}</p> : null}
            {r.helpSlug ? (
              <Link href={ccPath(l, `/help/${r.helpSlug}`)} className="text-sm font-semibold text-accent underline underline-offset-2">
                {t("helpLink")}
              </Link>
            ) : null}
          </div>
        </div>
        {r.checks.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-ink">{t("checksTitle")}</p>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {r.checks.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-center gap-2 text-sm text-body">
                  {c.passed ? (
                    <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-buy" />
                  ) : (
                    <CircleAlert aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-inventory" />
                  )}
                  <span>{KNOWN_CHECKS.has(c.name) ? t(`check.${c.name}` as "check.volume") : c.name}</span>
                  <span className="sr-only">{c.passed ? t("checkPassed") : t("checkFailed")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {r.xpGained > 0 || r.newBadges > 0 || r.certificateCode ? (
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-ink">
            {r.xpGained > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Sparkles aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
                {t("xpGained", { xp: formatNumber(r.xpGained, l) })}
              </span>
            ) : null}
            {r.newBadges > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Award aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
                {t("newBadge")}
              </span>
            ) : null}
            {r.certificateCode ? (
              <Link href={ccPath(l, `/training/certificates/${r.certificateCode}`)} className="text-accent underline underline-offset-2">
                {t("certificateEarned")} {t("openCertificate")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

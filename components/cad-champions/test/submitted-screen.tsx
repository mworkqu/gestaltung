"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Clock3, FileSearch, FileX2, Loader2, UserCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/cad-champions/format";
import { ccPath } from "@/lib/cad-champions/routes";
import { allSettled, type LiveTaskState } from "@/lib/cad-champions/test/status";

const POLL_MS = 5000;

const TONE: Record<LiveTaskState, ChipTone> = {
  no_file: "neutral",
  checking: "info",
  done: "success",
  waiting_trainer: "warning",
  /** Grader failed or not set up: a person checks the file. Not the student's fault. */
  error: "info",
};

const ICON = {
  no_file: FileX2,
  checking: Loader2,
  done: CheckCircle2,
  waiting_trainer: UserCheck,
  error: FileSearch,
} as const;

/**
 * "Test submitted" screen: what happens next, plus a live status line per
 * task (polls GET /api/cad-champions/attempts/[id]/status every 5 s until
 * nothing is still being checked).
 */
export function SubmittedScreen({
  attemptId,
  tasks,
  initial,
  submittedAt,
  submitReason,
  hasDrawings,
}: {
  attemptId: string;
  tasks: { id: string; number: number; title: string }[];
  initial: Record<string, LiveTaskState>;
  submittedAt: string | null;
  submitReason: "manual" | "timeout" | "admin" | null;
  hasDrawings: boolean;
}) {
  const t = useTranslations("CC.test");
  const locale = useLocale() as Locale;
  const [states, setStates] = React.useState<Record<string, LiveTaskState>>(initial);
  const [pollError, setPollError] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const settled = loaded && allSettled(tasks.map((x) => states[x.id] ?? "checking"));

  React.useEffect(() => {
    if (settled) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/cad-champions/attempts/${attemptId}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { tasks?: { id: string; state: LiveTaskState }[] };
        if (cancelled) return;
        setStates(Object.fromEntries((body.tasks ?? []).map((x) => [x.id, x.state])));
        setPollError(false);
        setLoaded(true);
      } catch {
        if (!cancelled) setPollError(true);
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [attemptId, settled]);

  return (
    <div className="space-y-6">
      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-submitted-title">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-buy-bg text-buy">
            <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-6 w-6" />
          </span>
          <div>
            <h2 id="cc-submitted-title" className="text-2xl font-extrabold text-heading">
              {t("submitted.title")}
            </h2>
            {submittedAt ? (
              <p className="mt-1 text-sm text-body">
                {t(`submitted.reason.${submitReason ?? "manual"}`, { date: formatDateTime(submittedAt, locale) })}
              </p>
            ) : null}
          </div>
        </div>

        <h3 className="text-base font-extrabold text-heading">{t("submitted.nextTitle")}</h3>
        <ol className="list-decimal space-y-1.5 ps-5 text-sm text-body">
          <li>{t("submitted.next1")}</li>
          {hasDrawings ? <li>{t("submitted.next2")}</li> : null}
          <li>{t("submitted.next3")}</li>
          <li>{t("submitted.next4")}</li>
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={ccPath(locale, "/dashboard")}>{t("submitted.dashboard")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={ccPath(locale, `/results/${attemptId}`)}>{t("submitted.results")}</Link>
          </Button>
        </div>
      </section>

      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-submitted-status">
        <div className="flex items-center gap-2">
          <Clock3 aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
          <h2 id="cc-submitted-status" className="text-xl font-extrabold text-heading">
            {t("submitted.statusTitle")}
          </h2>
        </div>
        {pollError ? <Alert tone="warning" title={t("submitted.pollErrorTitle")}>{t("submitted.pollError")}</Alert> : null}
        <ul className="space-y-2" aria-live="polite">
          {tasks.map((task) => {
            const s = states[task.id];
            const Icon = s ? ICON[s] : CircleDashed;
            return (
              <li key={task.id} className="tile flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-body">{t("workspace.taskN", { n: String(task.number) })}</span>
                  <span className="block truncate text-sm font-bold text-ink">{task.title}</span>
                </span>
                {s ? (
                  <StatusChip tone={TONE[s]} icon={Icon} className={s === "checking" ? "[&>svg]:motion-safe:animate-spin" : undefined}>
                    {t(`submitted.state.${s}`)}
                  </StatusChip>
                ) : (
                  <span className="h-6 w-28 rounded-full bg-panel motion-safe:animate-pulse" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
        {tasks.some((x) => states[x.id] === "error") ? (
          <Alert tone="info" title={t("submitted.state.error")}>
            {t("submitted.manualNote")}
          </Alert>
        ) : null}
      </section>
    </div>
  );
}

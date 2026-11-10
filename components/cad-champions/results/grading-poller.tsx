"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileX2, Loader2, OctagonAlert, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { LiveTaskState } from "@/lib/cad-champions/test/status";

const POLL_MS = 5000;
const TONE: Record<LiveTaskState, ChipTone> = { no_file: "neutral", checking: "info", done: "success", waiting_trainer: "warning", error: "danger" };
const ICON = { no_file: FileX2, checking: Loader2, done: CheckCircle2, waiting_trainer: UserCheck, error: OctagonAlert } as const;

/**
 * "Still grading" state: live progress per task. Polls the existing
 * GET /api/cad-champions/attempts/[id]/status every 5 s and refreshes the page
 * once the attempt has left "submitted" / "grading".
 */
export function GradingPoller({ attemptId, tasks }: { attemptId: string; tasks: { id: string; number: number; title: string }[] }) {
  const t = useTranslations("CC.results.states");
  const tState = useTranslations("CC.test.submitted");
  const tTask = useTranslations("CC.results.tasks");
  const router = useRouter();
  const [states, setStates] = React.useState<Record<string, LiveTaskState>>({});
  const [pollError, setPollError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let refreshed = false;
    async function poll() {
      try {
        const res = await fetch(`/api/cad-champions/attempts/${attemptId}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { status?: string; tasks?: { id: string; state: LiveTaskState }[] };
        if (cancelled) return;
        setStates(Object.fromEntries((body.tasks ?? []).map((x) => [x.id, x.state])));
        setPollError(false);
        if (body.status && body.status !== "submitted" && body.status !== "grading" && !refreshed) {
          refreshed = true;
          router.refresh();
        }
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
  }, [attemptId, router]);

  return (
    <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="cc-grading-title">
      <div className="flex items-start gap-3">
        <Loader2 aria-hidden="true" strokeWidth={1.75} className="mt-1 h-6 w-6 shrink-0 text-accent motion-safe:animate-spin" />
        <div>
          <h2 id="cc-grading-title" className="text-xl font-extrabold text-heading">
            {t("gradingTitle")}
          </h2>
          <p className="mt-1 text-sm text-body">{t("gradingText")}</p>
        </div>
      </div>
      {pollError ? <Alert tone="warning" title={t("pollError")} /> : null}
      <ul className="space-y-2" aria-live="polite">
        {tasks.map((task) => {
          const s = states[task.id];
          const Icon = s ? ICON[s] : Loader2;
          return (
            <li key={task.id} className="tile flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-body">{tTask("taskN", { n: String(task.number) })}</span>
                <span className="block truncate text-sm font-bold text-ink">{task.title}</span>
              </span>
              {s ? (
                <StatusChip tone={TONE[s]} icon={Icon} className={s === "checking" ? "[&>svg]:motion-safe:animate-spin" : undefined}>
                  {tState(`state.${s}`)}
                </StatusChip>
              ) : (
                <span className="h-6 w-28 rounded-full bg-panel motion-safe:animate-pulse" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

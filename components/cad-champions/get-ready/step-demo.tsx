"use client";

import * as React from "react";
import { CheckCircle2, Circle, CloudUpload, Download, FileText, PartyPopper, Timer } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, StatusChip, useToast } from "@/components/cad-champions/ui";
import { DEMO_COACH_MARKS, DEMO_SECONDS, DEMO_TASKS, type DemoCoachMark } from "@/lib/cad-champions/get-ready/content";
import { Ltr } from "@/lib/cad-champions/ltr";
import { cn } from "@/lib/utils";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Step 6: a static copy of the test workspace with a fake 5-minute timer and
 * five coach marks. Nothing is uploaded or saved; only finishing the tour
 * marks the step done.
 */
export function StepDemo({ done, onDone }: { done: boolean; onDone: () => void }) {
  const t = useTranslations("CC.get-ready");
  const toast = useToast();
  const [started, setStarted] = React.useState(false);
  const [coach, setCoach] = React.useState<number | null>(null);
  const [finished, setFinished] = React.useState(false);
  const [seconds, setSeconds] = React.useState(DEMO_SECONDS);
  const calloutRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [started]);

  React.useEffect(() => {
    if (coach !== null) calloutRef.current?.focus();
  }, [coach]);

  function start() {
    setStarted(true);
    setFinished(false);
    setSeconds(DEMO_SECONDS);
    setCoach(0);
  }

  function finish() {
    setCoach(null);
    setFinished(true);
    if (!done) onDone();
  }

  const active: DemoCoachMark | null = coach === null ? null : DEMO_COACH_MARKS[coach];
  const ring = (mark: DemoCoachMark) => (active === mark ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "");

  function renderCallout(mark: DemoCoachMark) {
    if (active !== mark || coach === null) return null;
    const last = coach === DEMO_COACH_MARKS.length - 1;
    return (
      <div
        ref={calloutRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`demo-coach-${mark}`}
        className="relative mt-3 rounded-2xl bg-ink p-4 text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true" className="absolute -top-1.5 start-6 h-3 w-3 rotate-45 bg-ink" />
        <p className="text-xs font-semibold text-white/70">{t("demo.coachLabel", { n: String(coach + 1), total: String(DEMO_COACH_MARKS.length) })}</p>
        <p id={`demo-coach-${mark}`} className="mt-1 text-sm font-bold">
          {t(`demo.coach.${mark}.title`)}
        </p>
        <p className="mt-1 text-sm text-white/90">{t(`demo.coach.${mark}.body`)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {coach > 0 ? (
            <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setCoach(coach - 1)}>
              {t("demo.back")}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => (last ? finish() : setCoach(coach + 1))}>
            {last ? t("demo.finish") : t("demo.next")}
          </Button>
          {!last ? (
            <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={finish}>
              {t("demo.skip")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-body">{t("demo.intro")}</p>
      <Button type="button" variant={started ? "secondary" : "primary"} onClick={start}>
        {started ? t("demo.restart") : t("demo.start")}
      </Button>

      <div className="neu-inset space-y-4 rounded-2xl p-3 sm:p-4" aria-label={t("demo.notSaved")} role="group">
        {/* Top bar: demo label, timer, submit */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-neu-sm">
          <StatusChip tone="warning">{t("demo.notSaved")}</StatusChip>
          <div className={cn("flex items-center gap-2 rounded-xl px-3 py-1.5", ring("timer"))}>
            <Timer aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
            <span className="text-xs font-semibold text-body">{t("demo.timerLabel")}</span>
            <Ltr className={cn("font-mono text-lg font-bold tabular-nums", seconds <= 60 && started ? "text-[#a1231f]" : "text-ink")}>
              {mmss(seconds)}
            </Ltr>
          </div>
          <Button type="button" size="sm" className={ring("submit")} onClick={() => toast.info(t("demo.submit"), t("demo.submitToast"))}>
            {t("demo.submit")}
          </Button>
        </div>
        {renderCallout("timer")}
        {renderCallout("submit")}
        {started && seconds === 0 ? <p className="text-sm font-semibold text-[#a1231f]">{t("demo.timeUp")}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          {/* Task list */}
          <div>
            <div className={cn("rounded-xl bg-surface p-3 shadow-neu-sm", ring("tasks"))}>
              <p className="mb-2 text-xs font-semibold text-body">{t("demo.tasksTitle")}</p>
              <ul className="space-y-1">
                {DEMO_TASKS.map((task, i) => (
                  <li
                    key={task}
                    className={cn("flex items-start gap-2 rounded-lg px-2 py-2 text-sm", i === 1 ? "bg-panel font-semibold text-ink" : "text-body")}
                  >
                    {i === 0 ? (
                      <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-buy" />
                    ) : (
                      <Circle aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-mutedtext" />
                    )}
                    <span className="min-w-0">
                      <span className="block">{t(`demo.tasks.${task}.title`)}</span>
                      <span className="block text-xs text-body">{t(`demo.tasks.${task}.status`)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {renderCallout("tasks")}
          </div>

          {/* Task panel */}
          <div className="space-y-4">
            <div className={cn("rounded-xl bg-surface p-4 shadow-neu-sm", ring("brief"))}>
              <p className="text-base font-extrabold text-heading">{t("demo.briefTitle")}</p>
              <p className="mt-1 text-sm text-body">{t("demo.briefText")}</p>
              <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => toast.info(t("demo.briefDownload"), t("demo.briefToast"))}>
                <FileText aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("demo.briefDownload")}
                <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              </Button>
            </div>
            {renderCallout("brief")}

            <div className={cn("rounded-xl bg-surface p-4 shadow-neu-sm", ring("upload"))}>
              <p className="text-sm font-bold text-ink">{t("demo.uploadTitle")}</p>
              <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-center">
                <CloudUpload aria-hidden="true" strokeWidth={1.5} className="h-7 w-7 text-accent" />
                <p className="text-sm text-body">{t("demo.uploadHint")}</p>
                <Button type="button" size="sm" onClick={() => toast.info(t("demo.uploadButton"), t("demo.uploadToast"))}>
                  {t("demo.uploadButton")}
                </Button>
              </div>
            </div>
            {renderCallout("upload")}
          </div>
        </div>
      </div>

      {finished || (done && !started) ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-buy/20 bg-buy-bg p-4">
          <PartyPopper aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-6 w-6 shrink-0 text-buy rtl:-scale-x-100" />
          <div>
            <p className="text-base font-extrabold text-ink">{t("demo.doneTitle")}</p>
            <p className="mt-1 text-sm text-body">{t("demo.doneBody")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Hand,
  Loader2,
  RotateCcw,
  Send,
  Users,
  WifiOff,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, ConfirmDialog, HelpTip, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { CC_EVENTS, track } from "@/lib/cad-champions/analytics";
import { formatDateTime, formatFileSize, formatNumber } from "@/lib/cad-champions/format";
import { HELP_SLUGS } from "@/lib/cad-champions/get-ready/content";
import { Ltr } from "@/lib/cad-champions/ltr";
import {
  createSignedDownload,
  recordPhaseMarkerAction,
  recordSubmissionAction,
  submitAttemptAction,
  type RecordResult,
} from "@/lib/cad-champions/test/actions";
import { taskChip, tasksWithoutFiles, type TaskChip } from "@/lib/cad-champions/test/status";
import {
  PART_COLLECTED_KEY,
  clockOffset,
  crossedThreshold,
  formatCountdown,
  graceEndsAt,
  parseTime,
  partCollectedDueAt,
  secondsUntil,
  warningLevel,
} from "@/lib/cad-champions/test/timer";
import { hasModule, type TaskView } from "@/lib/cad-champions/test/view";
import { taskPackageStatus } from "@/lib/cad-champions/upload/package-check";
import { cn } from "@/lib/utils";

import { ModuleChip } from "./module-chip";
import { PackagePanel, type PackageFile } from "./package-panel";

// Test workspace (Prompt 5 Step B/C). The deadline comes from the server; this
// page only displays it, synced with GET /api/cad-champions/time on load and
// every 60 s. Every task panel stays mounted (hidden when not selected) so an
// upload keeps running while the student reads another task. At the deadline
// the page waits for running uploads (up to the grace period) and then hands
// the test in; the server closes it anyway on the next request.

export interface StoredFile {
  fileName: string;
  size: number;
  uploadedAt: string;
}

export interface WorkspaceAttempt {
  id: string;
  startedAt: string;
  deadlineAt: string | null;
  inPerson: boolean;
  phaseMarkers: { key: string; at: string }[];
}

export interface WorkspaceProps {
  mode: "live" | "preview";
  testTitle: string;
  uploadMode: "per_task" | "module_package";
  graceSeconds: number;
  timeLimitMinutes: number | null;
  attempt: WorkspaceAttempt | null;
  userId: string;
  tasks: TaskView[];
  briefs: Record<string, React.ReactNode>;
  submissions: Record<string, StoredFile>;
  packageFile: PackageFile | null;
  serverNow: number;
}

type SaveFailure = { reason: Exclude<RecordResult, { ok: true }>["reason"]; upload: UploadedFile };

const CHIP_TONE: Record<TaskChip, ChipTone> = { not_started: "neutral", uploading: "info", uploaded: "success", failed: "danger" };
const PKG_TONE: Record<string, ChipTone> = { complete: "success", partial: "warning", missing: "danger", none: "neutral" };

const SYNC_EVERY_MS = 60_000;

export function TestWorkspace(props: WorkspaceProps) {
  const { mode, uploadMode, attempt, tasks, userId, graceSeconds } = props;
  const t = useTranslations("CC.test");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const live = mode === "live" && !!attempt;
  const isPackage = uploadMode === "module_package";

  // ------------------------------------------------------------ clock
  const deadline = live ? parseTime(attempt.deadlineAt) : null;
  const startedAt = attempt ? parseTime(attempt.startedAt) : null;
  const offsetRef = React.useRef(0);
  const [now, setNow] = React.useState(props.serverNow);
  const [synced, setSynced] = React.useState(false);

  React.useEffect(() => {
    if (!live) return;
    offsetRef.current = props.serverNow - Date.now();
    let cancelled = false;
    async function sync() {
      const sentAt = Date.now();
      try {
        const res = await fetch("/api/cad-champions/time", { cache: "no-store" });
        const receivedAt = Date.now();
        if (!res.ok) return;
        const body = (await res.json()) as { now?: number };
        if (!cancelled && typeof body.now === "number") {
          offsetRef.current = clockOffset({ serverNow: body.now, sentAt, receivedAt });
          setSynced(true);
        }
      } catch {
        // keep the last offset; the next sync tries again
      }
    }
    void sync();
    const syncTimer = window.setInterval(() => void sync(), SYNC_EVERY_MS);
    const tick = window.setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
      window.clearInterval(tick);
    };
  }, [live, props.serverNow]);

  const secondsLeft = deadline == null ? null : secondsUntil(deadline, now);
  const level = secondsLeft == null ? "none" : warningLevel(secondsLeft);

  // One-time notices when a threshold is crossed (not on page load).
  const prevLeft = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (secondsLeft == null) return;
    const crossed = crossedThreshold(prevLeft.current, secondsLeft);
    prevLeft.current = secondsLeft;
    if (crossed === 300) toast.info(t("workspace.warn5Toast"), t("workspace.warn5"));
  }, [secondsLeft, t, toast]);

  // ------------------------------------------------------------ files
  const [files, setFiles] = React.useState<Record<string, StoredFile>>(props.submissions);
  const [pkg, setPkg] = React.useState<PackageFile | null>(props.packageFile);
  const [uploading, setUploading] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});
  const [failed, setFailed] = React.useState<Record<string, SaveFailure | null>>({});
  const [pkgBusy, setPkgBusy] = React.useState(false);
  const [pkgFailed, setPkgFailed] = React.useState(false);
  const [active, setActive] = React.useState<string>(tasks[0]?.id ?? "");
  const [offline, setOffline] = React.useState(false);

  const busyCallbacks = React.useMemo(() => {
    const out: Record<string, (busy: boolean) => void> = {};
    for (const task of tasks) out[task.id] = (busy) => setUploading((u) => (u[task.id] === busy ? u : { ...u, [task.id]: busy }));
    return out;
  }, [tasks]);

  const anyBusy = pkgBusy || Object.values(uploading).some(Boolean) || Object.values(saving).some(Boolean);
  const anyFailed = pkgFailed || Object.values(failed).some(Boolean);

  React.useEffect(() => {
    setOffline(navigator.onLine === false);
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);

  // Saving to the test (after the file itself is stored) also counts as "in progress".
  React.useEffect(() => {
    if (!Object.values(saving).some(Boolean)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t("workspace.leaveWarning");
      return t("workspace.leaveWarning");
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saving, t]);

  async function save(task: TaskView, upload: UploadedFile) {
    if (!attempt) return;
    setSaving((s) => ({ ...s, [task.id]: true }));
    setFailed((f) => ({ ...f, [task.id]: null }));
    try {
      const res = await recordSubmissionAction({ attemptId: attempt.id, taskId: task.id, ...upload });
      if (res.ok) {
        setFiles((f) => ({ ...f, [task.id]: { fileName: upload.fileName, size: upload.size, uploadedAt: res.uploadedAt } }));
        toast.success(t("workspace.savedToast", { n: String(task.number) }), t("workspace.savedToastBody"));
        track(CC_EVENTS.testFileSaved, { replaced: res.replacedCount > 0 });
      } else {
        setFailed((f) => ({ ...f, [task.id]: { reason: res.reason, upload } }));
        toast.error(t("workspace.saveFailedTitle"), t(`workspace.saveFailed.${res.reason}`));
        if (res.reason === "closed") router.refresh();
      }
    } catch (e) {
      console.error("[cc-test] save failed:", e instanceof Error ? e.message : e);
      setFailed((f) => ({ ...f, [task.id]: { reason: "error", upload } }));
      toast.error(t("workspace.saveFailedTitle"), t("workspace.saveFailed.error"));
    } finally {
      setSaving((s) => ({ ...s, [task.id]: false }));
    }
  }

  const onPackageBusy = React.useCallback((b: boolean) => setPkgBusy(b), []);
  const onPackageChange = React.useCallback((f: PackageFile | null, didFail: boolean) => {
    setPkg(f);
    setPkgFailed(didFail);
  }, []);

  // ------------------------------------------------------------ submit
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const autoSubmitted = React.useRef(false);

  const submit = React.useCallback(async () => {
    if (!attempt) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const res = await submitAttemptAction(attempt.id);
      if (res.ok) {
        track(CC_EVENTS.testSubmitted, { reason: deadline != null && Date.now() + offsetRef.current >= deadline ? "timeout" : "manual" });
        setConfirmOpen(false);
        router.refresh();
        return;
      }
      setSubmitError(true);
    } catch (e) {
      console.error("[cc-test] submit failed:", e instanceof Error ? e.message : e);
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }, [attempt, deadline, router]);

  // Client half of auto-submit: at the deadline, wait for running uploads
  // (until deadline + grace), then hand in.
  const timeUp = live && deadline != null && now >= deadline;
  React.useEffect(() => {
    if (!timeUp || deadline == null || autoSubmitted.current) return;
    const waiting = anyBusy && now < graceEndsAt(deadline, graceSeconds);
    if (waiting) return;
    autoSubmitted.current = true;
    void submit();
  }, [timeUp, anyBusy, now, deadline, graceSeconds, submit]);

  const uploadedIds = isPackage ? (pkg ? tasks.map((x) => x.id) : []) : Object.keys(files);
  const missing = tasksWithoutFiles(tasks, uploadedIds);
  const listFormat = React.useMemo(() => new Intl.ListFormat(locale === "ar" ? "ar" : "en", { type: "conjunction" }), [locale]);
  const missingNames = listFormat.format(missing.map((m) => t("workspace.taskN", { n: String(m.number) })));
  const confirmText = [
    isPackage
      ? pkg
        ? t("workspace.submitPackageOk")
        : t("workspace.submitPackageMissing")
      : missing.length === 0
        ? t("workspace.submitAllDone")
        : t("workspace.submitMissing", { tasks: missingNames, count: missing.length }),
    t("workspace.submitFinal"),
  ].join(" ");

  // ------------------------------------------------------------ M4 phase marker
  const isM4 = hasModule(tasks, "M4");
  const showPhase = !!attempt?.inPerson && isM4;
  const [partCollectedAt, setPartCollectedAt] = React.useState<string | null>(
    () => attempt?.phaseMarkers.find((m) => m.key === PART_COLLECTED_KEY)?.at ?? null
  );
  const phaseDue = partCollectedDueAt(startedAt);
  const phaseRequested = React.useRef(false);
  React.useEffect(() => {
    if (!live || !showPhase || partCollectedAt || phaseDue == null || now < phaseDue || phaseRequested.current) return;
    phaseRequested.current = true;
    void recordPhaseMarkerAction(attempt.id, PART_COLLECTED_KEY)
      .then((res) => {
        if (res.ok) {
          setPartCollectedAt(res.at);
          toast.info(t("workspace.phaseToast"), t("workspace.phaseNow"));
        } else {
          phaseRequested.current = false;
        }
      })
      .catch(() => {
        phaseRequested.current = false;
      });
  }, [live, showPhase, partCollectedAt, phaseDue, now, attempt, t, toast]);

  // ------------------------------------------------------------ render helpers
  function chipFor(task: TaskView): { tone: ChipTone; label: string } {
    if (isPackage) {
      const s = taskPackageStatus(pkg?.manifest ?? null, task.id);
      return { tone: PKG_TONE[s], label: t(`workspace.pkgChip.${s}`) };
    }
    const c = taskChip({ uploaded: !!files[task.id], busy: !!uploading[task.id] || !!saving[task.id], failed: !!failed[task.id] });
    return { tone: CHIP_TONE[c], label: t(`workspace.chip.${c}`) };
  }

  const timerText = secondsLeft == null ? (mode === "preview" && props.timeLimitMinutes ? formatCountdown(props.timeLimitMinutes * 60) : null) : formatCountdown(secondsLeft);

  return (
    <div className="space-y-4">
      {/* Sticky bar: timer, save state, submit */}
      <div
        className={cn(
          "neu sticky top-16 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5",
          level === "critical" && "ring-2 ring-[#a1231f] motion-safe:animate-pulse"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Clock aria-hidden="true" strokeWidth={1.75} className={cn("h-5 w-5 shrink-0", level === "critical" || level === "over" ? "text-[#a1231f]" : "text-accent")} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-body">{t("workspace.timerLabel")}</p>
            <p
              className={cn("font-mono text-2xl font-extrabold tabular-nums", level === "critical" || level === "over" ? "text-[#a1231f]" : "text-heading")}
              role="timer"
              aria-live={level === "critical" ? "assertive" : "off"}
            >
              <Ltr>{timerText ?? t("workspace.untimed")}</Ltr>
            </p>
          </div>
          <HelpTip label={t("workspace.timerHelpLabel")} learnMoreSlug={HELP_SLUGS.howTheTestWorks}>
            {t("workspace.timerHelp")}
          </HelpTip>
        </div>

        {attempt?.inPerson ? (
          <StatusChip tone="info" icon={Users}>
            {t("workspace.studio")}
          </StatusChip>
        ) : null}

        <div className="ms-auto flex flex-wrap items-center gap-3">
          {mode === "live" ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold" role="status" aria-live="polite">
              {anyBusy ? (
                <>
                  <Loader2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 animate-spin text-accent motion-reduce:animate-none" />
                  <span className="text-body">{t("workspace.pending")}</span>
                </>
              ) : anyFailed ? (
                <>
                  <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-inventory" />
                  <span className="text-body">{t("workspace.needsAttention")}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-buy" />
                  <span className="text-body">{t("workspace.allSaved")}</span>
                </>
              )}
            </span>
          ) : null}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!live || anyBusy || submitting}
            disabledReason={!live ? t("workspace.previewDisabled") : anyBusy ? t("workspace.submitBusyReason") : undefined}
            loading={submitting && !confirmOpen}
            loadingText={t("workspace.submitting")}
          >
            <Send aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
            {t("workspace.submit")}
          </Button>
        </div>
      </div>

      {/* Banners */}
      {mode === "preview" ? (
        <Alert tone="info" title={t("workspace.previewTitle")}>
          <span className="inline-flex items-center gap-2">
            <Eye aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("workspace.previewBanner")}
          </span>
        </Alert>
      ) : null}
      {live && !synced ? <p className="text-xs text-mutedtext">{t("workspace.syncing")}</p> : null}
      {offline ? (
        <Alert tone="warning" title={t("workspace.offlineTitle")}>
          <span className="inline-flex items-start gap-2">
            <WifiOff aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0" />
            {t("workspace.offlineBody")}
          </span>
        </Alert>
      ) : null}
      {timeUp ? (
        <Alert
          tone="error"
          title={t("workspace.timeUpTitle")}
          action={
            submitError ? (
              <Button size="sm" variant="secondary" onClick={() => void submit()} loading={submitting} loadingText={t("workspace.submitting")}>
                <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("workspace.tryAgain")}
              </Button>
            ) : undefined
          }
        >
          {submitError ? t("workspace.submitError") : anyBusy ? t("workspace.timeUpBusy", { seconds: formatNumber(graceSeconds, locale) }) : t("workspace.timeUpSubmitting")}
        </Alert>
      ) : level === "critical" ? (
        <Alert tone="error" title={t("workspace.warn1Title")}>
          {t("workspace.warn1", { seconds: formatNumber(graceSeconds, locale) })}
        </Alert>
      ) : level === "urgent" ? (
        <Alert tone="warning" title={t("workspace.warn5Title")}>
          {t("workspace.warn5")}
        </Alert>
      ) : level === "warning" ? (
        <Alert tone="info" title={t("workspace.warn15Title")}>
          {t("workspace.warn15")}
        </Alert>
      ) : null}
      {!timeUp && submitError ? (
        <Alert tone="error" title={t("workspace.submitErrorTitle")}>
          {t("workspace.submitError")}
        </Alert>
      ) : null}

      {showPhase ? (
        <div className="tile flex items-start gap-3" role="status">
          <Hand aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div>
            <p className="text-sm font-bold text-ink">{t("workspace.phaseTitle")}</p>
            <p className="text-sm text-body">
              {partCollectedAt
                ? t("workspace.phaseDone", { time: formatDateTime(partCollectedAt, locale) })
                : phaseDue != null && live
                  ? t("workspace.phasePending", { time: formatCountdown(secondsUntil(phaseDue, now)) })
                  : t("workspace.phaseRule")}
            </p>
          </div>
        </div>
      ) : null}

      {isPackage ? (
        <PackagePanel
          mode={mode}
          attemptId={attempt?.id ?? null}
          userId={userId}
          tasks={tasks}
          initial={props.packageFile}
          disabled={!live || timeUp}
          onBusyChange={onPackageBusy}
          onChange={onPackageChange}
        />
      ) : null}

      {/* Task navigation + panels */}
      {tasks.length === 0 ? (
        <Alert tone="info" title={t("intro.noTasksTitle")}>
          {t("intro.noTasksBody")}
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
          <nav aria-label={t("workspace.tasksNav")} className="min-w-0">
            <ul className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0" role="tablist" aria-orientation="vertical">
              {tasks.map((task) => {
                const chip = chipFor(task);
                const selected = task.id === active;
                return (
                  <li key={task.id} className="shrink-0 md:shrink">
                    <button
                      type="button"
                      role="tab"
                      id={`cc-task-tab-${task.id}`}
                      aria-selected={selected}
                      aria-controls={`cc-task-panel-${task.id}`}
                      onClick={() => setActive(task.id)}
                      className={cn(
                        "flex min-h-[44px] w-full flex-col items-start gap-1.5 rounded-2xl border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        selected ? "border-accent bg-[#e3edfb]" : "border-border bg-surface hover:bg-panel"
                      )}
                    >
                      <span className="text-xs font-semibold text-body">{t("workspace.taskN", { n: String(task.number) })}</span>
                      <span className="line-clamp-2 max-w-[12rem] text-sm font-bold text-ink md:max-w-none">{task.title}</span>
                      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                      {!isPackage && files[task.id] ? (
                        <span className="max-w-[12rem] truncate text-xs text-body md:max-w-full">
                          <Ltr>{files[task.id].fileName}</Ltr>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0">
            {tasks.map((task) => (
              <TaskPanel
                key={task.id}
                hidden={task.id !== active}
                task={task}
                brief={props.briefs[task.id]}
                mode={mode}
                isPackage={isPackage}
                attemptId={attempt?.id ?? null}
                userId={userId}
                file={files[task.id] ?? null}
                failure={failed[task.id] ?? null}
                saving={!!saving[task.id]}
                disabled={!live || timeUp}
                onUploaded={(u) => void save(task, u)}
                onRetry={(u) => void save(task, u)}
                onBusyChange={busyCallbacks[task.id]}
              />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("workspace.submitDialogTitle")}
        consequence={confirmText}
        confirmLabel={t("workspace.submitConfirm")}
        loading={submitting}
        onConfirm={submit}
      />
    </div>
  );
}

function TaskPanel({
  hidden,
  task,
  brief,
  mode,
  isPackage,
  attemptId,
  userId,
  file,
  failure,
  saving,
  disabled,
  onUploaded,
  onRetry,
  onBusyChange,
}: {
  hidden: boolean;
  task: TaskView;
  brief: React.ReactNode;
  mode: "live" | "preview";
  isPackage: boolean;
  attemptId: string | null;
  userId: string;
  file: StoredFile | null;
  failure: SaveFailure | null;
  saving: boolean;
  disabled: boolean;
  onUploaded: (u: UploadedFile) => void;
  onRetry: (u: UploadedFile) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("CC.test");
  const locale = useLocale() as Locale;
  const accept = task.expectedUpload === "none" ? null : task.expectedUpload;

  return (
    <section
      id={`cc-task-panel-${task.id}`}
      role="tabpanel"
      aria-labelledby={`cc-task-tab-${task.id}`}
      hidden={hidden}
      className="neu space-y-5 p-5 sm:p-6"
    >
      <header className="space-y-2">
        <p className="text-xs font-semibold text-body">{t("workspace.taskN", { n: String(task.number) })}</p>
        <h2 className="text-xl font-extrabold text-heading">{task.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {task.skillName ? <StatusChip tone="neutral">{task.skillName}</StatusChip> : null}
          {task.moduleCode ? <ModuleChip code={task.moduleCode} name={task.moduleName} /> : null}
          <StatusChip tone="info">{t("workspace.points", { n: formatNumber(task.points, locale) })}</StatusChip>
        </div>
      </header>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold text-heading">{t("workspace.briefTitle")}</h3>
        {brief ?? <p className="text-sm text-body">{t("workspace.noBrief")}</p>}
      </div>

      <Downloads task={task} />

      {task.density != null ? (
        <div className="rounded-2xl border border-[#c3d6f3] bg-[#e3edfb] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1 text-xs font-semibold text-[#0a3f8f]">
                {t("workspace.materialTitle")}
                <HelpTip label={t("intro.densityHelpLabel")} learnMoreSlug={HELP_SLUGS.materialDensity}>
                  {t("intro.densityHelp")}
                </HelpTip>
              </p>
              <p className="text-lg font-extrabold text-ink">
                {task.material ? `${task.material} · ` : ""}
                <Ltr>{formatNumber(task.density, locale)} kg/m³</Ltr>
              </p>
            </div>
            <CopyButton value={String(task.density)} label={t("workspace.copyLabel", { value: String(task.density) })} />
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <p className="text-sm text-ink">
          <span className="font-bold">{t("workspace.whatToUpload")}: </span>
          {isPackage
            ? task.expectedFiles.length > 0
              ? t("workspace.inZipExpected")
              : t("workspace.inZip")
            : t(`whatToUpload.${task.expectedUpload}`)}
        </p>
        {isPackage && task.expectedFiles.length > 0 ? (
          <ul className="space-y-1">
            {task.expectedFiles.map((p) => (
              <li key={p} className="text-sm">
                <Ltr className="font-mono text-xs text-ink">{p}</Ltr>
              </li>
            ))}
          </ul>
        ) : null}

        {!isPackage && accept ? (
          <>
            <UploadBox
              accept={accept}
              bucket="cc-submissions"
              pathPrefix={`${userId}/${attemptId ?? "preview"}/${task.id}/`}
              onUploaded={onUploaded}
              disabled={disabled || mode === "preview" || !attemptId}
              current={file}
              label={t("workspace.uploadLabel", { n: String(task.number) })}
              onBusyChange={onBusyChange}
            />
            {file && !failure ? (
              <p className="flex items-center gap-1.5 text-xs text-body">
                <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-3.5 w-3.5 text-buy" />
                {t("workspace.savedAt", { time: formatDateTime(file.uploadedAt, locale) })} · <Ltr>{formatFileSize(file.size, locale)}</Ltr>
              </p>
            ) : null}
            {failure ? (
              <Alert
                tone="error"
                title={t("workspace.saveFailedTitle")}
                action={
                  failure.reason !== "closed" ? (
                    <Button size="sm" variant="secondary" loading={saving} loadingText={t("workspace.saving")} onClick={() => onRetry(failure.upload)}>
                      <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                      {t("workspace.saveRetry")}
                    </Button>
                  ) : undefined
                }
              >
                {t(`workspace.saveFailed.${failure.reason}`)}
              </Alert>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function Downloads({ task }: { task: TaskView }) {
  const t = useTranslations("CC.test");
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function get(path: string, how: "open" | "download") {
    setBusy(`${how}:${path}`);
    // Open the tab now (inside the click) so pop-up blockers allow it; fill it once the link is ready.
    const win = how === "open" ? window.open("about:blank", "_blank") : null;
    try {
      const res = await createSignedDownload(task.id, path, how);
      if (!res.ok) {
        win?.close();
        toast.error(t("workspace.downloadErrorTitle"), res.reason === "missing" ? t("workspace.downloadMissing") : t("workspace.downloadError"));
        return;
      }
      if (win) {
        win.opener = null;
        win.location.replace(res.url);
      } else if (how === "open") {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        window.location.assign(res.url);
      }
    } catch (e) {
      win?.close();
      console.error("[cc-test] download failed:", e instanceof Error ? e.message : e);
      toast.error(t("workspace.downloadErrorTitle"), t("workspace.downloadError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-extrabold text-heading">{t("workspace.filesTitle")}</h3>
      {task.attachments.length === 0 ? (
        <p className="text-sm text-body">{t("workspace.noFiles")}</p>
      ) : (
        <ul className="space-y-2">
          {task.attachments.map((a) => (
            <li key={a.path} className="tile flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                <FileText aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate">{a.label}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" loading={busy === `open:${a.path}`} loadingText={t("workspace.opening")} onClick={() => void get(a.path, "open")}>
                  <ExternalLink aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
                  {t("workspace.open")}
                </Button>
                <Button size="sm" variant="secondary" loading={busy === `download:${a.path}`} loadingText={t("workspace.opening")} onClick={() => void get(a.path, "download")}>
                  <Download aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("workspace.download")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations("CC.test");
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => {
      window.clearTimeout(id);
    };
  }, [copied]);
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <Check aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-buy" /> : <Copy aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />}
      <span aria-live="polite">{copied ? t("workspace.copied") : t("workspace.copy")}</span>
    </Button>
  );
}

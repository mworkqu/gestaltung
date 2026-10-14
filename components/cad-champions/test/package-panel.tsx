"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, FileArchive, FolderCheck, FolderX, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, HelpTip, Spinner, StatusChip, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { HELP_SLUGS } from "@/lib/cad-champions/get-ready/content";
import { formatDateTime, formatFileSize, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { recordSubmissionAction, validatePackageAction, type RecordResult } from "@/lib/cad-champions/test/actions";
import type { TaskView } from "@/lib/cad-champions/test/view";
import { PACKAGE_MAX_BYTES, type ExpectedItemStatus, type PackageManifest, type PackageWarning } from "@/lib/cad-champions/upload/package-check";

export interface PackageFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  manifest: PackageManifest | null;
}

const ITEM_TONE: Record<ExpectedItemStatus, ChipTone> = { found: "success", native_only: "warning", missing: "danger" };

/**
 * module_package upload: ONE ZIP of the Results folder. After the upload the
 * server lists the ZIP (no extraction) and returns the found-vs-expected
 * checklist, which is shown here.
 */
export function PackagePanel({
  mode,
  attemptId,
  userId,
  tasks,
  initial,
  disabled,
  onBusyChange,
  onChange,
}: {
  mode: "live" | "preview";
  attemptId: string | null;
  userId: string;
  tasks: TaskView[];
  initial: PackageFile | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChange: (file: PackageFile | null, failed: boolean) => void;
}) {
  const t = useTranslations("CC.test");
  const locale = useLocale() as Locale;
  const [file, setFile] = React.useState<PackageFile | null>(initial);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [saveError, setSaveError] = React.useState<{ reason: Exclude<RecordResult, { ok: true }>["reason"]; upload: UploadedFile } | null>(null);
  const [checkError, setCheckError] = React.useState(false);
  // Latest file, readable right after save() sets it (before the next render).
  const fileRef = React.useRef<PackageFile | null>(initial);

  React.useEffect(() => {
    onBusyChange(uploading || saving || checking);
  }, [uploading, saving, checking, onBusyChange]);

  const check = React.useCallback(async () => {
    if (!attemptId) return;
    setChecking(true);
    setCheckError(false);
    try {
      const res = await validatePackageAction(attemptId);
      const cur = fileRef.current;
      if (res.ok && cur) {
        const next = { ...cur, manifest: res.manifest };
        fileRef.current = next;
        setFile(next);
        onChange(next, false);
      } else if (!res.ok) {
        setCheckError(true);
      }
    } catch (e) {
      console.error("[cc-test] package check failed:", e instanceof Error ? e.message : e);
      setCheckError(true);
    } finally {
      setChecking(false);
    }
  }, [attemptId, onChange]);

  async function save(upload: UploadedFile) {
    if (!attemptId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await recordSubmissionAction({ attemptId, taskId: null, ...upload });
      if (!res.ok) {
        setSaveError({ reason: res.reason, upload });
        onChange(file, true);
        return;
      }
      const next: PackageFile = { fileName: upload.fileName, size: upload.size, uploadedAt: res.uploadedAt, manifest: null };
      fileRef.current = next;
      setFile(next);
      onChange(next, false);
    } catch (e) {
      console.error("[cc-test] package save failed:", e instanceof Error ? e.message : e);
      setSaveError({ reason: "error", upload });
      onChange(file, true);
      return;
    } finally {
      setSaving(false);
    }
    await check();
  }

  const m = file?.manifest ?? null;
  const taskTitle = (id: string) => {
    const task = tasks.find((x) => x.id === id);
    return task ? t("workspace.taskN", { n: String(task.number) }) : "";
  };

  function warningText(w: PackageWarning): React.ReactNode {
    switch (w.code) {
      case "missing_folder":
        return t.rich("package.warnings.missing_folder", { folder: w.folder, b: (c) => <Ltr>{c}</Ltr> });
      case "wrong_type":
        return t.rich("package.warnings.wrong_type", { file: w.file, ext: w.ext, folder: w.folder, b: (c) => <Ltr>{c}</Ltr> });
      case "no_step":
        return t.rich("package.warnings.no_step", { label: w.label, exts: w.exts.join(", "), task: taskTitle(w.taskId), b: (c) => <Ltr>{c}</Ltr> });
      case "missing_file":
        return t.rich("package.warnings.missing_file", { label: w.label, task: taskTitle(w.taskId), b: (c) => <Ltr>{c}</Ltr> });
      case "outside_results":
        return t.rich("package.warnings.outside_results", { file: w.file, b: (c) => <Ltr>{c}</Ltr> });
    }
  }

  return (
    <section aria-labelledby="cc-package-title" className="neu space-y-5 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <FileArchive aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
        <h2 id="cc-package-title" className="text-lg font-extrabold text-heading">
          {t("package.title")}
        </h2>
        <HelpTip label={t("package.helpLabel")} learnMoreSlug={HELP_SLUGS.resultsFolder}>
          {t("package.help")}
        </HelpTip>
      </div>
      <p className="text-sm text-body">{t("package.intro")}</p>

      <UploadBox
        accept="zip"
        maxBytes={PACKAGE_MAX_BYTES}
        bucket="cc-submissions"
        pathPrefix={`${userId}/${attemptId ?? "preview"}/package/`}
        onUploaded={save}
        disabled={disabled || mode === "preview" || !attemptId}
        current={file ? { fileName: file.fileName, size: file.size } : null}
        label={t("package.label")}
        onBusyChange={setUploading}
      />

      {file ? (
        <p className="text-xs text-body">
          {t("workspace.savedAt", { time: formatDateTime(file.uploadedAt, locale) })} · <Ltr>{formatFileSize(file.size, locale)}</Ltr>
        </p>
      ) : null}

      {saveError ? (
        <Alert
          tone="error"
          title={t("workspace.saveFailedTitle")}
          action={
            saveError.reason !== "closed" ? (
              <Button size="sm" variant="secondary" loading={saving} loadingText={t("workspace.saving")} onClick={() => void save(saveError.upload)}>
                <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("workspace.saveRetry")}
              </Button>
            ) : undefined
          }
        >
          {t(`workspace.saveFailed.${saveError.reason}`)}
        </Alert>
      ) : null}

      {checking ? (
        <Spinner size="sm" label={t("package.checking")} />
      ) : null}

      {checkError ? (
        <Alert
          tone="error"
          title={t("package.checkFailedTitle")}
          action={
            <Button size="sm" variant="secondary" onClick={() => void check()}>
              {t("package.recheck")}
            </Button>
          }
        >
          {t("package.checkFailed")}
        </Alert>
      ) : null}

      {file && !m && !checking && !checkError && mode === "live" ? (
        <Button size="sm" variant="secondary" onClick={() => void check()}>
          {t("package.recheck")}
        </Button>
      ) : null}

      {m ? (
        <div className="space-y-5" aria-live="polite">
          {m.errors.length > 0 ? (
            <Alert tone="error" title={t("package.errorsTitle")}>
              <ul className="list-disc space-y-1 ps-5">
                {m.errors.map((e) => (
                  <li key={e}>{t(`package.errors.${e}`)}</li>
                ))}
              </ul>
            </Alert>
          ) : m.warnings.length === 0 ? (
            <Alert tone="success" title={t("package.allGood")}>
              {t("package.summary", { files: formatNumber(m.fileCount, locale) })}
            </Alert>
          ) : (
            <Alert tone="warning" title={t("package.warningsTitle")}>
              <ul className="list-disc space-y-1 ps-5">
                {m.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{warningText(w)}</li>
                ))}
              </ul>
              {m.warnings.length > 30 ? <p className="mt-1">{t("package.moreWarnings", { n: formatNumber(m.warnings.length - 30, locale) })}</p> : null}
            </Alert>
          )}

          {m.tasks.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-extrabold text-heading">{t("package.tasksTitle")}</h3>
              <ul className="space-y-2">
                {m.tasks.map((task) => (
                  <li key={task.taskId} className="tile space-y-2">
                    <p className="text-sm font-bold text-ink">{taskTitle(task.taskId)}</p>
                    <ul className="space-y-1.5">
                      {task.items.map((item) => (
                        <li key={item.pattern} className="flex flex-wrap items-center gap-2 text-sm">
                          <StatusChip tone={ITEM_TONE[item.status]}>{t(`package.item.${item.status}`)}</StatusChip>
                          <Ltr className="font-mono text-xs text-ink">{item.pattern}</Ltr>
                          {item.files.length > 0 ? (
                            <span className="text-xs text-body">
                              → <Ltr>{item.files.map((f) => f.split("/").pop()).join(", ")}</Ltr>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-body">{t("package.noExpectations")}</p>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-extrabold text-heading">{t("package.foldersTitle")}</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {m.folders.map((f) => (
                <li key={f.key} className="flex items-center gap-2 text-sm">
                  {f.present ? (
                    <FolderCheck aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-buy" />
                  ) : f.required ? (
                    <FolderX aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-[#a1231f]" />
                  ) : (
                    <CircleAlert aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0 text-mutedtext" />
                  )}
                  <Ltr className="text-ink">{f.name}</Ltr>
                  <span className="text-xs text-body">
                    {f.present ? t("package.folderFiles", { n: formatNumber(f.fileCount, locale) }) : t("package.folderMissing")}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {m.unmatched.length > 0 ? (
            <details className="tile">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {t("package.unmatchedTitle", { n: formatNumber(m.unmatched.length, locale) })}
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-body">
                {m.unmatched.slice(0, 50).map((u) => (
                  <li key={u}>
                    <Ltr>{u}</Ltr>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {mode === "live" && !checking ? (
            <Button size="sm" variant="ghost" onClick={() => void check()}>
              <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("package.recheck")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

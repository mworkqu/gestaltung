"use client";

import * as React from "react";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { gradeSampleAction, type SampleAspect, type Target } from "@/app/[locale]/cad-champions/admin/tests/content-actions";
import { UploadBox } from "@/components/cad-champions/upload/upload-box";
import { Alert, HelpTip, Spinner, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { sampleFilesPrefix } from "@/lib/cad-champions/admin/test-builder";
import { formatNumber } from "@/lib/cad-champions/format";
import type { GraderMode, StudentGradeResult } from "@/lib/cad-champions/grader/mapping";
import { Ltr } from "@/lib/cad-champions/ltr";

import { useErrorText } from "./use-admin-action";

// "Grade a sample" (Prompt 11 Step B): any STEP is graded with this task's
// saved reference + tolerances; the score and the student-facing feedback
// (the same student-safe mapping real results use) are shown. Nothing is
// written; the uploaded sample is deleted after grading.

export function GradeSamplePanel({ target, graderReady, referenceReady }: { target: Target; graderReady: boolean; referenceReady: boolean }) {
  const t = useTranslations("CC.admin.tests");
  const locale = useLocale() as Locale;
  const errorText = useErrorText();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<{ result: StudentGradeResult; aspects: SampleAspect[]; mode: GraderMode } | null>(null);
  const [boxKey, setBoxKey] = React.useState(0);
  const n = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });

  async function grade(path: string) {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const res = await gradeSampleAction({ target, path });
      if (res.ok) setOut(res.data);
      else setError(errorText(res));
    } catch (e) {
      console.error("[cc-admin] sample failed:", e instanceof Error ? e.message : "unknown");
      setError(errorText({ ok: false, error: "error" }));
    } finally {
      setBusy(false);
      setBoxKey((k) => k + 1);
    }
  }

  const disabledReason = !graderReady ? t("sample.notConfigured") : !referenceReady ? t("sample.needReference") : null;

  return (
    <section className="flex flex-col gap-4" aria-label={t("sample.title")}>
      <h4 className="flex items-center gap-1 text-base font-bold text-heading">
        <FlaskConical aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
        {t("sample.title")}
        <HelpTip label={t("sample.helpLabel")}>{t("sample.help")}</HelpTip>
      </h4>
      {disabledReason ? (
        <Alert tone="info" title={disabledReason} />
      ) : (
        <>
          <UploadBox key={boxKey} accept="step" bucket="cc-answer-files" pathPrefix={sampleFilesPrefix(target.kind, target.id)} replaceable={false} label={t("sample.uploadLabel")} onUploaded={(f) => grade(f.path)} disabled={busy} />
          {busy ? <Spinner size="sm" label={t("sample.grading")} /> : null}
        </>
      )}
      {error ? <Alert tone="error" title={t("sample.failedTitle")}>{error}</Alert> : null}

      {out ? (
        <div className="tile flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl font-extrabold text-heading">
              <Ltr>{`${n(out.result.score)} / ${n(out.result.maxPoints)}`}</Ltr>
            </p>
            <StatusChip tone={out.result.passed ? "success" : "danger"}>{out.result.passed ? t("sample.passed") : t("sample.notPassed")}</StatusChip>
            {out.result.practiceScore != null ? <span className="text-sm text-mutedtext">{t("sample.practiceScore", { score: n(out.result.practiceScore) })}</span> : null}
            <span className="text-xs text-mutedtext">{t("sample.mode", { mode: t(`graderModes.${out.mode}`) })}</span>
          </div>
          {out.result.errorCode ? (
            <p className="text-sm text-ink">
              {t("sample.errorCode")} <Ltr className="font-mono">{out.result.errorCode}</Ltr>
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">{t("sample.feedbackEn")}</p>
              <p lang="en" dir="ltr" className="whitespace-pre-line text-sm text-ink">
                {out.result.feedbackEn || "-"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-mutedtext">{t("sample.feedbackAr")}</p>
              <p lang="ar" dir="rtl" className="whitespace-pre-line text-sm text-ink">
                {out.result.feedbackAr || "-"}
              </p>
            </div>
          </div>

          {out.aspects.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink">{t("sample.aspects")}</p>
              <ul className="flex flex-col gap-1">
                {out.aspects.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    {a.passed ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-buy" strokeWidth={1.75} /> : <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={1.75} />}
                    <span className="flex-1">{(locale === "ar" ? a.description_ar : a.description_en) || a.description_en}</span>
                    <Ltr className="shrink-0 text-mutedtext">{`${n(a.points)} / ${n(a.maxPoints)}`}</Ltr>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {out.result.checks.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink">{t("sample.checks")}</p>
              <ul className="flex flex-wrap gap-2">
                {out.result.checks.map((c) => (
                  <li key={c.name}>
                    <StatusChip tone={c.passed ? "success" : "danger"}>
                      <Ltr className="font-mono">{c.name}</Ltr>
                    </StatusChip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {out.result.warnings.length > 0 ? (
            <p className="text-xs text-mutedtext">
              {t("sample.warnings")} <Ltr>{out.result.warnings.join(", ")}</Ltr>
            </p>
          ) : null}
          <p className="text-xs text-mutedtext">{t("sample.nothingSaved")}</p>
        </div>
      ) : null}
    </section>
  );
}

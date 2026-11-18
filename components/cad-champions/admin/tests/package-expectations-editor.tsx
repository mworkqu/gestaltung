"use client";

import * as React from "react";
import { FolderTree } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { savePackageExpectationsAction } from "@/app/[locale]/cad-champions/admin/tests/actions";
import { CheckboxField, textareaCls } from "@/components/cad-champions/admin/fields";
import { Button, EmptyState, HelpTip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { draftFromJson, patternsFromText, suggestPattern, validatePattern, type ExpectationsDraft } from "@/lib/cad-champions/admin/package-expectations";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { RESULTS_FOLDERS, type ResultsFolderKey } from "@/lib/cad-champions/upload/package-check";
import { cn } from "@/lib/utils";

import { useAdminAction } from "./use-admin-action";

// Package expectations for module_package tests (COMPETITION_ALIGNMENT §F):
// which Results folders must exist, and per task the expected files by name
// pattern ("Parts and Assemblies/Part_03.*"). Written in the exact shape the
// student validator (upload/package-check.ts parseExpectations) reads.

export interface ExpectationTask {
  id: string;
  number: number;
  title: string;
  expected_upload: string;
}

export function PackageExpectationsEditor({ testId, tasks, value }: { testId: string; tasks: ExpectationTask[]; value: unknown }) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy } = useAdminAction();
  const initial = React.useMemo(() => draftFromJson(value, tasks.map((x) => x.id)), [value, tasks]);
  const [required, setRequired] = React.useState<ResultsFolderKey[]>(initial.requiredFolders);
  const [text, setText] = React.useState<Record<string, string>>(() => Object.fromEntries(initial.tasks.map((x) => [x.taskId, x.patterns.join("\n")])));
  const [step, setStep] = React.useState<Record<string, boolean>>(() => Object.fromEntries(initial.tasks.map((x) => [x.taskId, x.requireStep])));

  const problems = tasks.flatMap((task) =>
    patternsFromText(text[task.id] ?? "")
      .map((p) => ({ task, p, e: validatePattern(p) }))
      .filter((x) => x.e),
  );

  async function save() {
    const draft: ExpectationsDraft = {
      requiredFolders: required,
      tasks: tasks.map((x) => ({ taskId: x.id, patterns: patternsFromText(text[x.id] ?? ""), requireStep: step[x.id] ?? true })),
    };
    await run(() => savePackageExpectationsAction({ testId, draft }), { success: t("package.saved"), successBody: t("package.savedBody") });
  }

  return (
    <section className="flex flex-col gap-5" aria-label={t("package.title")}>
      <p className="text-sm text-body">{t("package.intro")}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1 text-sm font-semibold text-ink">
          {t("package.requiredFolders")}
          <HelpTip label={t("package.foldersHelpLabel")}>{t("package.foldersHelp")}</HelpTip>
        </legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {RESULTS_FOLDERS.map((f) => (
            <CheckboxField
              key={f.key}
              label={f.name}
              checked={required.includes(f.key)}
              onChange={(v) => setRequired((prev) => (v ? [...prev, f.key] : prev.filter((k) => k !== f.key)))}
            />
          ))}
        </div>
      </fieldset>

      {tasks.length === 0 ? (
        <EmptyState icon={FolderTree} title={t("package.noTasksTitle")} description={t("package.noTasksBody")} />
      ) : (
        <ol className="flex flex-col gap-3">
          {tasks.map((task) => {
            const lines = patternsFromText(text[task.id] ?? "");
            return (
              <li key={task.id} className="tile flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">
                  {t("issues.taskPrefix", { n: formatNumber(task.number, locale) })} {task.title}
                </p>
                <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                  {t("package.patterns")}
                  <textarea
                    className={cn(textareaCls, "min-h-20 font-mono text-xs")}
                    dir="ltr"
                    value={text[task.id] ?? ""}
                    placeholder={suggestPattern(task.number, task.expected_upload)}
                    onChange={(e) => setText((p) => ({ ...p, [task.id]: e.target.value }))}
                  />
                  <span className="text-xs font-normal text-mutedtext">{t("package.patternsHint")}</span>
                </label>
                {lines.length === 0 ? (
                  <div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setText((p) => ({ ...p, [task.id]: suggestPattern(task.number, task.expected_upload) }))}>
                      {t("package.useSuggestion")} <Ltr className="font-mono">{suggestPattern(task.number, task.expected_upload)}</Ltr>
                    </Button>
                  </div>
                ) : null}
                <CheckboxField label={t("package.requireStep")} hint={t("package.requireStepHint")} checked={step[task.id] ?? true} onChange={(v) => setStep((p) => ({ ...p, [task.id]: v }))} />
              </li>
            );
          })}
        </ol>
      )}

      {problems.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-destructive">
          {problems.map((x, i) => (
            <li key={i}>
              {t("issues.taskPrefix", { n: formatNumber(x.task.number, locale) })} <Ltr className="font-mono">{x.p}</Ltr>: {t(`fields.${x.e}`)}
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <Button type="button" onClick={save} loading={busy} loadingText={tc("saving")} disabled={problems.length > 0} disabledReason={problems.length > 0 ? t("package.fixFirst") : undefined}>
          {t("package.save")}
        </Button>
      </div>
    </section>
  );
}

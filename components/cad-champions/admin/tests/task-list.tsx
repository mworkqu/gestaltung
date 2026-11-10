"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ListOrdered, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { deleteTaskAction, moveTaskAction, saveTaskAction } from "@/app/[locale]/cad-champions/admin/tests/actions";
import { Button, ConfirmDialog, EmptyState, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { pointsMatch } from "@/lib/cad-champions/admin/aspects";
import { briefFilesPrefix } from "@/lib/cad-champions/admin/test-builder";
import type { CcCompetitionModule, CcSkillArea, CcTaskAspect, CcTestTask } from "@/lib/cad-champions/db/types";
import { formatNumber } from "@/lib/cad-champions/format";
import { isReferenceComplete } from "@/lib/cad-champions/grader/mapping";
import { cn } from "@/lib/utils";

import { ContentPanels } from "./content-panels";
import { GradableFields, gradableFromRow, gradablePayload, type GradableState } from "./gradable-fields";
import { useAdminAction } from "./use-admin-action";

// Tasks of a test: add / edit / delete and reorder (up / down buttons keep
// `position` 1..n on the server). A saved task opens its marking tools.

type Skill = Pick<CcSkillArea, "id" | "name_en" | "name_ar">;
type Mod = Pick<CcCompetitionModule, "code" | "name_en" | "name_ar">;

function TaskForm({
  testId,
  task,
  skills,
  modules,
  onSaved,
  onCancel,
}: {
  testId: string;
  task: CcTestTask | null;
  skills: Skill[];
  modules: Mod[];
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const { run, busy } = useAdminAction();
  const [state, setState] = React.useState<GradableState>(() => gradableFromRow(task, { skill_area_id: "3", max_points: "10" }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => saveTaskAction({ testId, taskId: task?.id ?? null, fields: gradablePayload(state) }), {
      success: task ? tc("saved") : t("task.created"),
      successBody: task ? undefined : t("task.createdBody"),
    });
    if (res?.ok) onSaved(res.data.id);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <GradableFields value={state} onChange={setState} skills={skills} modules={modules} attachmentsPrefix={task ? briefFilesPrefix("task", task.id) : null} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} loadingText={tc("saving")}>
          {task ? t("task.save") : t("task.create")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {tc("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function TaskList({
  testId,
  tasks,
  aspects,
  skills,
  modules,
  graderReady,
}: {
  testId: string;
  tasks: CcTestTask[];
  aspects: CcTaskAspect[];
  skills: Skill[];
  modules: Mod[];
  graderReady: boolean;
}) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy } = useAdminAction();
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<CcTestTask | null>(null);
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  const n = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });
  const label = (en: string | null | undefined, ar: string | null | undefined) => (locale === "ar" ? ar || en : en || ar) ?? "";

  return (
    <div className="flex flex-col gap-4">
      {sorted.length === 0 && !adding ? <EmptyState icon={ListOrdered} title={t("tasks.emptyTitle")} description={t("tasks.emptyBody")} /> : null}
      <ol className="flex flex-col gap-3">
        {sorted.map((task, i) => {
          const mine = aspects.filter((a) => a.task_id === task.id);
          const isOpen = open === task.id;
          const skill = skills.find((s) => Number(s.id) === Number(task.skill_area_id));
          const refOk = task.grading_mode !== "auto_step" || isReferenceComplete(task.reference_data);
          const ptsOk = mine.length === 0 || pointsMatch(mine, task.max_points);
          return (
            <li key={task.id} className="neu flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : task.id)}
                  aria-expanded={isOpen}
                  className="flex min-h-11 min-w-0 flex-1 items-start gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-panel text-sm font-bold text-heading">{formatNumber(i + 1, locale)}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold text-heading">{label(task.title_en, task.title_ar)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-mutedtext">
                      <span>{skill ? `${skill.id}. ${label(skill.name_en, skill.name_ar)}` : "-"}</span>
                      {task.competition_module ? <StatusChip tone="info">{task.competition_module}</StatusChip> : null}
                      <span>{t("aspects.pointsShort", { points: n(Number(task.max_points)) })}</span>
                      <span>{t(`gradingModes.${task.grading_mode}`)}</span>
                      {!refOk ? <StatusChip tone="warning">{t("tasks.noReference")}</StatusChip> : null}
                      {!ptsOk ? <StatusChip tone="danger">{t("tasks.pointsMismatch")}</StatusChip> : null}
                      <span>{t("tasks.aspectCount", { count: mine.length })}</span>
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className={cn("ms-auto mt-2 h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")} strokeWidth={1.75} />
                </button>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveUp")} disabled={i === 0 || busy} onClick={() => run(() => moveTaskAction({ testId, taskId: task.id, dir: "up" }))}>
                    <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveDown")} disabled={i === sorted.length - 1 || busy} onClick={() => run(() => moveTaskAction({ testId, taskId: task.id, dir: "down" }))}>
                    <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(task)}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    {tc("delete")}
                  </Button>
                </div>
              </div>
              {isOpen ? (
                <div className="flex flex-col gap-8 border-t border-border pt-5">
                  <TaskForm key={task.updated_at} testId={testId} task={task} skills={skills} modules={modules} onSaved={() => undefined} />
                  <div className="border-t border-border pt-5">
                    <ContentPanels
                      kind="task"
                      row={{ ...task, max_points: Number(task.max_points), skill_area_id: Number(task.skill_area_id) }}
                      aspects={mine}
                      skills={skills}
                      modules={modules}
                      graderReady={graderReady}
                    />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {adding ? (
        <div className="neu flex flex-col gap-4 p-4 sm:p-5">
          <h3 className="text-lg font-bold text-heading">{t("tasks.newTitle")}</h3>
          <TaskForm
            testId={testId}
            task={null}
            skills={skills}
            modules={modules}
            onSaved={(id) => {
              setAdding(false);
              setOpen(id);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <div>
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            {t("tasks.add")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("tasks.deleteTitle")}
        consequence={t("tasks.deleteBody")}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await run(() => deleteTaskAction({ testId, taskId: deleting.id }), { success: t("tasks.deleted") });
          if (res) setDeleting(null);
        }}
      />
    </div>
  );
}

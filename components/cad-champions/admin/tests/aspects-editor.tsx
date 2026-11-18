"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { addStandardAspectsAction, deleteAspectAction, moveAspectAction, saveAspectAction, type Target } from "@/app/[locale]/cad-champions/admin/tests/content-actions";
import { BilingualField, CheckboxField, Field, inputCls, textareaCls } from "@/components/cad-champions/admin/fields";
import { Alert, Button, ConfirmDialog, EmptyState, HelpTip, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { aspectSplit, AUTO_CHECK_KEYS, pointsMatch, sumAspectPoints } from "@/lib/cad-champions/admin/aspects";
import { CC_ASPECT_METHODS, CC_ASPECT_TYPES, type CcCompetitionModule, type CcSkillArea, type CcTaskAspect } from "@/lib/cad-champions/db/types";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { cn } from "@/lib/utils";

import { SplitMeter } from "./split-meter";
import { useAdminAction } from "./use-admin-action";

// Marking aspects of one task or exercise (COMPETITION_ALIGNMENT section D):
// measurement (all-or-nothing unless a partial rule) or judgement (0-3,
// trainer). Rubric aspects (check key rubric:<id>) come from the rubric
// editor and are edited there.

type Skill = Pick<CcSkillArea, "id" | "name_en" | "name_ar">;
type Mod = Pick<CcCompetitionModule, "code" | "name_en" | "name_ar">;

interface FormState {
  description_en: string;
  description_ar: string;
  skill_area_id: string;
  competition_module: string;
  type: string;
  max_points: string;
  method: string;
  check_key: string;
  partial: boolean;
  partial_rule: string;
  student_hint_en: string;
  student_hint_ar: string;
}

function formFrom(a: CcTaskAspect | null, d: { skill: string; module: string; method: string }): FormState {
  return {
    description_en: a?.description_en ?? "",
    description_ar: a?.description_ar ?? "",
    skill_area_id: a ? String(a.skill_area_id) : d.skill,
    competition_module: a ? (a.competition_module ?? "") : d.module,
    type: a?.type ?? "measurement",
    max_points: a ? String(Number(a.max_points)) : "",
    method: a?.method ?? d.method,
    check_key: a?.check_key ?? "",
    partial: a?.partial_rule != null,
    partial_rule: a?.partial_rule != null ? JSON.stringify(a.partial_rule) : '{"kind":"grader_points"}',
    student_hint_en: a?.student_hint_en ?? "",
    student_hint_ar: a?.student_hint_ar ?? "",
  };
}

function AspectForm({
  target,
  aspect,
  skills,
  modules,
  defaults,
  onDone,
}: {
  target: Target;
  aspect: CcTaskAspect | null;
  skills: Skill[];
  modules: Mod[];
  defaults: { skill: string; module: string; method: string };
  onDone: () => void;
}) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy } = useAdminAction();
  const [f, setF] = React.useState<FormState>(() => formFrom(aspect, defaults));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const label = (en: string, ar: string) => (locale === "ar" ? ar || en : en || ar);
  const keyIsPreset = f.check_key === "" || (AUTO_CHECK_KEYS as readonly string[]).includes(f.check_key);
  const [customKey, setCustomKey] = React.useState(!keyIsPreset);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fields = { ...f, partial_rule: f.partial && f.type === "measurement" ? f.partial_rule : "" };
    const res = await run(() => saveAspectAction({ target, aspectId: aspect?.id ?? null, fields }), { success: tc("saved") });
    if (res?.ok) onDone();
  }

  return (
    <form onSubmit={submit} className="tile flex flex-col gap-4">
      <BilingualField label={t("aspects.description")} required maxLength={600} en={{ value: f.description_en, onChange: (v) => set("description_en", v) }} ar={{ value: f.description_ar, onChange: (v) => set("description_ar", v) }} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("fields.type")}>
          <select
            className={inputCls}
            value={f.type}
            onChange={(e) => setF((p) => ({ ...p, type: e.target.value, method: e.target.value === "judgement" ? "trainer" : p.method }))}
          >
            {CC_ASPECT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`aspects.types.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.points")}>
          <input className={inputCls} dir="ltr" inputMode="decimal" required value={f.max_points} onChange={(e) => set("max_points", e.target.value)} />
        </Field>
        <Field label={t("fields.method")}>
          <select className={inputCls} value={f.method} onChange={(e) => set("method", e.target.value)}>
            {CC_ASPECT_METHODS.filter((m) => f.type !== "judgement" || m === "trainer").map((x) => (
              <option key={x} value={x}>
                {t(`aspects.methods.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.check_key")} hint={t("aspects.checkKeyHint")}>
          {customKey ? (
            <input className={cn(inputCls, "font-mono")} dir="ltr" value={f.check_key} placeholder="part:Base" onChange={(e) => set("check_key", e.target.value)} />
          ) : (
            <select
              className={inputCls}
              value={f.check_key}
              onChange={(e) => {
                if (e.target.value === "__custom") {
                  setCustomKey(true);
                  return;
                }
                set("check_key", e.target.value);
              }}
            >
              <option value="">{tc("none")}</option>
              {AUTO_CHECK_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`aspects.checkKeys.${k}`)}
                </option>
              ))}
              <option value="__custom">{t("aspects.checkKeyCustom")}</option>
            </select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("fields.skill_area_id")}>
          <select className={inputCls} value={f.skill_area_id} onChange={(e) => set("skill_area_id", e.target.value)}>
            {!f.skill_area_id ? <option value="">{tc("none")}</option> : null}
            {skills.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {`${s.id}. ${label(s.name_en, s.name_ar)}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.competition_module")}>
          <select className={inputCls} value={f.competition_module} onChange={(e) => set("competition_module", e.target.value)}>
            <option value="">{t("task.noModule")}</option>
            {modules.map((m) => (
              <option key={m.code} value={m.code}>
                {`${m.code} · ${label(m.name_en, m.name_ar)}`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {f.type === "measurement" ? (
        <div className="flex flex-col gap-2">
          <CheckboxField label={t("aspects.partial")} hint={t("aspects.partialHint")} checked={f.partial} onChange={(v) => set("partial", v)} />
          {f.partial ? (
            <Field label={t("fields.partial_rule")} hint={t("aspects.partialRuleHint")}>
              <textarea className={cn(textareaCls, "min-h-16 font-mono text-xs")} dir="ltr" value={f.partial_rule} onChange={(e) => set("partial_rule", e.target.value)} />
            </Field>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-mutedtext">{t("aspects.judgementNote")}</p>
      )}
      <BilingualField label={t("aspects.hint")} hint={t("aspects.hintHint")} multiline rows={2} maxLength={1000} en={{ value: f.student_hint_en, onChange: (v) => set("student_hint_en", v) }} ar={{ value: f.student_hint_ar, onChange: (v) => set("student_hint_ar", v) }} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} loadingText={tc("saving")}>
          {tc("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function AspectsEditor({
  target,
  aspects,
  skills,
  modules,
  maxPoints,
  gradingMode,
  skillAreaId,
  competitionModule,
}: {
  target: Target;
  aspects: CcTaskAspect[];
  skills: Skill[];
  modules: Mod[];
  maxPoints: number;
  gradingMode: string;
  skillAreaId: number | null;
  competitionModule: string | null;
}) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy } = useAdminAction();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<CcTaskAspect | null>(null);
  const n = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });
  const sorted = [...aspects].sort((a, b) => a.position - b.position);
  const sum = sumAspectPoints(sorted);
  const matches = pointsMatch(sorted, maxPoints);
  const defaults = {
    skill: skillAreaId ? String(skillAreaId) : "",
    module: competitionModule ?? "",
    method: gradingMode === "auto_step" ? "auto_step" : gradingMode === "ai_drawing" ? "ai_drawing" : "trainer",
  };
  const hasStandard = sorted.some((a) => ["volume", "area", "inertia", "solids"].includes(a.check_key ?? ""));

  return (
    <section className="flex flex-col gap-4" aria-label={t("aspects.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1 text-base font-bold text-heading">
          {t("aspects.title")}
          <HelpTip label={t("aspects.helpLabel")}>{t("aspects.help")}</HelpTip>
        </h4>
        <div className="flex flex-wrap gap-2">
          {gradingMode === "auto_step" && !hasStandard ? (
            <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => run(() => addStandardAspectsAction({ target }), { success: t("aspects.standardDone") })}>
              <Wand2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              {t("aspects.addStandard")}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={() => setEditing("new")} disabled={editing === "new"}>
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            {t("aspects.add")}
          </Button>
        </div>
      </div>

      <SplitMeter split={aspectSplit(sorted)} />
      {sorted.length > 0 ? (
        <p className={cn("text-sm", matches ? "text-mutedtext" : "font-semibold text-destructive")}>
          {matches ? t("aspects.sumOk", { sum: n(sum), max: n(maxPoints) }) : t("aspects.sumMismatch", { sum: n(sum), max: n(maxPoints) })}
        </p>
      ) : null}

      {editing === "new" ? <AspectForm target={target} aspect={null} skills={skills} modules={modules} defaults={defaults} onDone={() => setEditing(null)} /> : null}

      {sorted.length === 0 && editing !== "new" ? (
        <EmptyState icon={ListChecks} title={t("aspects.emptyTitle")} description={gradingMode === "auto_step" ? t("aspects.emptyAuto") : t("aspects.emptyBody")} />
      ) : (
        <ol className="flex flex-col gap-2">
          {sorted.map((a, i) => {
            const fromRubric = (a.check_key ?? "").startsWith("rubric:");
            if (editing === a.id) {
              return (
                <li key={a.id}>
                  <AspectForm target={target} aspect={a} skills={skills} modules={modules} defaults={defaults} onDone={() => setEditing(null)} />
                </li>
              );
            }
            return (
              <li key={a.id} className="tile flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-semibold text-ink">{locale === "ar" ? a.description_ar || a.description_en : a.description_en}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-mutedtext">
                    <StatusChip tone={a.type === "judgement" ? "warning" : "info"}>{t(`aspects.types.${a.type}`)}</StatusChip>
                    <span>{t("aspects.pointsShort", { points: n(Number(a.max_points)) })}</span>
                    <span>{t(`aspects.methods.${a.method}`)}</span>
                    {a.check_key ? <Ltr className="font-mono">{a.check_key}</Ltr> : null}
                    {a.partial_rule != null ? <span>{t("aspects.partialShort")}</span> : null}
                    {fromRubric ? <StatusChip tone="neutral">{t("aspects.fromRubric")}</StatusChip> : null}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveUp")} disabled={i === 0 || busy} onClick={() => run(() => moveAspectAction({ target, aspectId: a.id, dir: "up" }))}>
                    <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={tc("moveDown")} disabled={i === sorted.length - 1 || busy} onClick={() => run(() => moveAspectAction({ target, aspectId: a.id, dir: "down" }))}>
                    <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                  {!fromRubric ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(a.id)}>
                        <Pencil aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                        {tc("edit")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(a)}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                        {tc("delete")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {sorted.some((a) => (a.check_key ?? "").startsWith("rubric:")) ? <Alert tone="info" title={t("aspects.rubricNote")} /> : null}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("aspects.deleteTitle")}
        consequence={t("aspects.deleteBody")}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await run(() => deleteAspectAction({ target, aspectId: deleting.id }), { success: t("aspects.deleted") });
          if (res) setDeleting(null);
        }}
      />
    </section>
  );
}

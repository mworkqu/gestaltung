"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { saveLevelAction } from "@/app/[locale]/cad-champions/admin/lessons/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Alert, useToast } from "@/components/cad-champions/ui";
import { parseUnlockRule } from "@/lib/cad-champions/admin/lessons";
import type { CcLevel } from "@/lib/cad-champions/db/types";
import { Ltr } from "@/lib/cad-champions/ltr";

import { FormError, SaveBar, Section, fieldHasError, selectCls, type SaveFailure } from "./shared";

// Level editor (Prompt 11): titles, goal, level number, unlock rule and the
// published state. The unlock rule is a choice (open / previous level passed
// at a pass mark); an unknown stored rule is kept as it is.

type Mode = "open" | "previous_level_passed" | "keep";

export function LevelForm({ level, backHref }: { level: CcLevel; backHref: string }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const router = useRouter();
  const toast = useToast();
  const initial = parseUnlockRule(level.unlock_rule);
  const [titleEn, setTitleEn] = React.useState(level.title_en);
  const [titleAr, setTitleAr] = React.useState(level.title_ar);
  const [goalEn, setGoalEn] = React.useState(level.goal_en ?? "");
  const [goalAr, setGoalAr] = React.useState(level.goal_ar ?? "");
  const [number, setNumber] = React.useState(String(level.level_number));
  const [mode, setMode] = React.useState<Mode>(initial.mode);
  const [passMark, setPassMark] = React.useState(String(initial.mode === "previous_level_passed" ? initial.passMark : 80));
  const [published, setPublished] = React.useState(level.is_published);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<SaveFailure>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const res = await saveLevelAction(level.id, {
        title_en: titleEn,
        title_ar: titleAr,
        goal_en: goalEn,
        goal_ar: goalAr,
        level_number: number,
        unlock_rule: { mode, passMark },
        is_published: published,
      });
      if (res.ok) {
        toast.success(tc("saved"), t("level.savedBody"));
        router.refresh();
      } else {
        setFailure({ error: res.error, detail: res.detail });
        toast.error(tc(`errors.${res.error}`));
      }
    } catch (err) {
      console.error("[cc-admin-lessons] level save failed", err);
      setFailure({ error: "error" });
      toast.error(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <FormError failure={failure} />
      <Section title={t("level.basics")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("level.number")} hint={t("level.numberHint")}>
            <input type="number" inputMode="numeric" min={0} max={6} value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} aria-invalid={fieldHasError(failure, "level_number") || undefined} />
          </Field>
          <Field label={t("level.unlock")} hint={t("level.unlockHint")}>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={selectCls}>
              <option value="open">{t("level.unlockOpen")}</option>
              <option value="previous_level_passed">{t("level.unlockPrevious")}</option>
              {initial.mode === "keep" ? <option value="keep">{t("level.unlockKeep")}</option> : null}
            </select>
          </Field>
          {mode === "previous_level_passed" ? (
            <Field label={t("level.passMark")} hint={t("level.passMarkHint")}>
              <input type="number" inputMode="decimal" min={1} max={100} step="any" value={passMark} onChange={(e) => setPassMark(e.target.value)} className={inputCls} aria-invalid={fieldHasError(failure, "unlock_rule") || undefined} />
            </Field>
          ) : null}
        </div>
        <p className="text-xs text-mutedtext">
          {t("level.ruleStored")} <Ltr className="font-mono">{JSON.stringify(level.unlock_rule)}</Ltr>
        </p>
        <CheckboxField label={t("lesson.published")} hint={t("level.publishedHint")} checked={published} onChange={setPublished} />
        {published !== level.is_published ? <Alert tone="info" title={published ? t("level.willPublish") : t("level.willUnpublish")} /> : null}
      </Section>
      <Section title={t("level.texts")}>
        <BilingualField label={t("lesson.title")} required maxLength={200} en={{ value: titleEn, onChange: setTitleEn }} ar={{ value: titleAr, onChange: setTitleAr }} />
        <BilingualField label={t("level.goal")} hint={t("level.goalHint")} multiline rows={3} maxLength={1000} en={{ value: goalEn, onChange: setGoalEn }} ar={{ value: goalAr, onChange: setGoalAr }} />
      </Section>
      <SaveBar
        saving={saving}
        label={tc("save")}
        savingLabel={tc("saving")}
        extra={
          <Link href={backHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-2 hover:underline">
            {t("backToTree")}
          </Link>
        }
      />
    </form>
  );
}

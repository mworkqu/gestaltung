"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { updateTestAction } from "@/app/[locale]/cad-champions/admin/tests/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { BilingualMarkdownEditor } from "@/components/cad-champions/admin/markdown-editor";
import { Button, HelpTip } from "@/components/cad-champions/ui";
import { CC_TEST_TYPES, CC_UPLOAD_MODES, type CcTest } from "@/lib/cad-champions/db/types";

import { useAdminAction } from "./use-admin-action";

// Test fields: titles, type, timing, retake cooldown, intro + rules (markdown,
// EN + AR side by side), staff-only flag and upload mode.

type TestFields = Pick<
  CcTest,
  "id" | "title_en" | "title_ar" | "type" | "time_limit_minutes" | "grace_seconds" | "retake_cooldown_days" | "intro_en" | "intro_ar" | "rules_en" | "rules_ar" | "admin_only" | "upload_mode"
>;

export function TestSettingsForm({ test }: { test: TestFields }) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const { run, busy } = useAdminAction();
  const [f, setF] = React.useState({
    title_en: test.title_en ?? "",
    title_ar: test.title_ar ?? "",
    type: test.type as string,
    time_limit_minutes: test.time_limit_minutes == null ? "" : String(test.time_limit_minutes),
    grace_seconds: String(test.grace_seconds ?? 60),
    retake_cooldown_days: String(test.retake_cooldown_days ?? 0),
    intro_en: test.intro_en ?? "",
    intro_ar: test.intro_ar ?? "",
    rules_en: test.rules_en ?? "",
    rules_ar: test.rules_ar ?? "",
    admin_only: !!test.admin_only,
    upload_mode: test.upload_mode as string,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => updateTestAction(test.id, f), { success: tc("saved"), successBody: t("settings.savedBody") });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <BilingualField label={t("fields.title")} required maxLength={200} en={{ value: f.title_en, onChange: (v) => set("title_en", v) }} ar={{ value: f.title_ar, onChange: (v) => set("title_ar", v) }} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("fields.type")}>
          <select className={inputCls} value={f.type} onChange={(e) => set("type", e.target.value)}>
            {CC_TEST_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("fields.time_limit_minutes")} hint={t("settings.timeHint")}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={f.time_limit_minutes} onChange={(e) => set("time_limit_minutes", e.target.value)} />
        </Field>
        <Field label={t("fields.grace_seconds")} hint={t("settings.graceHint")}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={f.grace_seconds} onChange={(e) => set("grace_seconds", e.target.value)} />
        </Field>
        <Field label={t("fields.retake_cooldown_days")} hint={t("settings.cooldownHint")}>
          <input className={inputCls} dir="ltr" inputMode="numeric" value={f.retake_cooldown_days} onChange={(e) => set("retake_cooldown_days", e.target.value)} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1 text-sm font-semibold text-ink">
          {t("fields.upload_mode")}
          <HelpTip label={t("settings.uploadModeHelpLabel")}>{t("settings.uploadModeHelp")}</HelpTip>
        </legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {CC_UPLOAD_MODES.map((m) => (
            <label key={m} className="tile flex min-h-11 cursor-pointer items-start gap-3 text-sm">
              <input type="radio" name="upload_mode" className="mt-0.5 h-5 w-5 shrink-0" checked={f.upload_mode === m} onChange={() => set("upload_mode", m)} />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink">{t(`uploadModes.${m}`)}</span>
                <span className="text-xs text-mutedtext">{t(`uploadModes.${m}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <CheckboxField label={t("fields.admin_only")} hint={t("settings.adminOnlyHint")} checked={f.admin_only} onChange={(v) => set("admin_only", v)} />

      <BilingualMarkdownEditor label={t("fields.intro")} hint={t("settings.introHint")} en={{ value: f.intro_en, onChange: (v) => set("intro_en", v) }} ar={{ value: f.intro_ar, onChange: (v) => set("intro_ar", v) }} rows={6} />
      <BilingualMarkdownEditor label={t("fields.rules")} hint={t("settings.rulesHint")} en={{ value: f.rules_en, onChange: (v) => set("rules_en", v) }} ar={{ value: f.rules_ar, onChange: (v) => set("rules_ar", v) }} rows={6} />

      <div>
        <Button type="submit" loading={busy} loadingText={tc("saving")}>
          {t("settings.save")}
        </Button>
      </div>
    </form>
  );
}

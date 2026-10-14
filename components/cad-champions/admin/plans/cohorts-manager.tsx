"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { saveCohortAction } from "@/app/[locale]/cad-champions/admin/plans/actions";
import { BilingualField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, EmptyState, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { seatsLeftOf } from "@/lib/cad-champions/admin/plans-admin";
import { CC_COHORT_STATUSES, type CcCohort, type CcCohortStatus } from "@/lib/cad-champions/db/types";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

import { FormErrors, SaveBar, formValues } from "./form-bits";

type Editing = CcCohort | "new" | null;
const selectCls = `${inputCls} pe-8`;
const TONE: Record<CcCohortStatus, ChipTone> = { draft: "neutral", open: "success", full: "warning", closed: "neutral", completed: "info" };

export function CohortsManager({ cohorts, seats }: { cohorts: CcCohort[]; seats: Record<string, number> }) {
  const t = useTranslations("CC.admin.plans");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string> | null>(null);
  const current = editing && editing !== "new" ? editing : null;

  function open(next: Editing) {
    setEditing(next);
    setErrors(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    setSaving(true);
    setErrors(null);
    try {
      const r = await saveCohortAction({ id: current?.id ?? null, values });
      if (r.ok) {
        toast.success(t("cohorts.saved"));
        setEditing(null);
        router.refresh();
      } else if ((r.error === "invalid" || r.error === "conflict") && r.fields) setErrors(r.fields);
      else toast.error(tc(`errors.${r.error}`));
    } finally {
      setSaving(false);
    }
  }

  const name = (c: CcCohort) => (locale === "ar" ? c.name_ar : c.name_en);

  return (
    <section aria-labelledby="cohorts-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cohorts-heading" className="title-section">
          {t("cohorts.heading")}
        </h2>
        {!editing ? <Button onClick={() => open("new")}>{t("cohorts.add")}</Button> : null}
      </div>
      <p className="text-sm text-body">{t("cohorts.intro")}</p>

      {editing ? (
        <form onSubmit={onSubmit} key={current?.id ?? "new"} className="neu space-y-5 p-5 sm:p-6">
          <h3 className="title-card">{current ? t("cohorts.editTitle", { name: name(current) }) : t("cohorts.newTitle")}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("fields.slug")} hint={current ? t("fields.slugLocked") : t("fields.slugHint")}>
              <input name="slug" defaultValue={current?.slug ?? ""} readOnly={!!current} required={!current} dir="ltr" className={inputCls} maxLength={60} />
            </Field>
            <Field label={t("fields.status")} hint={t("cohorts.statusHint")}>
              <select name="status" defaultValue={current?.status ?? "draft"} className={selectCls}>
                {CC_COHORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`cohorts.status.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fields.seatsTotal")} hint={current ? t("cohorts.seatsTaken", { taken: formatNumber(seats[current.id] ?? 0, locale) }) : t("fields.seatsHint")}>
              <input name="seats_total" type="number" inputMode="numeric" min={0} max={1000} step={1} defaultValue={current?.seats_total ?? 0} required dir="ltr" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("fields.startsOn")}>
                <input name="starts_on" type="date" defaultValue={current?.starts_on ?? ""} className={inputCls} />
              </Field>
              <Field label={t("fields.endsOn")}>
                <input name="ends_on" type="date" defaultValue={current?.ends_on ?? ""} className={inputCls} />
              </Field>
            </div>
          </div>
          <BilingualField label={t("fields.name")} required en={{ name: "name_en", defaultValue: current?.name_en }} ar={{ name: "name_ar", defaultValue: current?.name_ar }} maxLength={120} />
          <BilingualField label={t("fields.schedule")} multiline rows={2} en={{ name: "schedule_en", defaultValue: current?.schedule_en ?? "" }} ar={{ name: "schedule_ar", defaultValue: current?.schedule_ar ?? "" }} maxLength={400} />
          <BilingualField label={t("fields.location")} en={{ name: "location_en", defaultValue: current?.location_en ?? "" }} ar={{ name: "location_ar", defaultValue: current?.location_ar ?? "" }} maxLength={200} />
          <FormErrors errors={errors} fieldLabel={(f) => t(`fields.labels.${f}`)} />
          <SaveBar saving={saving} onCancel={() => setEditing(null)} />
        </form>
      ) : null}

      {cohorts.length === 0 ? (
        <EmptyState icon={CalendarRange} title={t("cohorts.empty.title")} description={t("cohorts.empty.body")} />
      ) : (
        <div className="neu-inset overflow-x-auto p-1">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-start text-sm">
            <caption className="sr-only">{t("cohorts.heading")}</caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                {(["name", "dates", "seats", "status"] as const).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                    {t(`cohorts.cols.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t("plans.cols.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => {
                const taken = seats[c.id] ?? 0;
                return (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-ink" dir="ltr">
                        {c.name_en}
                      </p>
                      <p className="text-body" dir="rtl">
                        {c.name_ar}
                      </p>
                      <p className="text-xs text-mutedtext">
                        <Ltr>{c.slug}</Ltr>
                      </p>
                    </td>
                    <td className="px-3 py-3 text-body">{c.starts_on ? `${formatDate(`${c.starts_on}T12:00:00+03:00`, locale)}${c.ends_on ? ` – ${formatDate(`${c.ends_on}T12:00:00+03:00`, locale)}` : ""}` : t("cohorts.noDates")}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {t("cohorts.seatsLine", { taken: formatNumber(taken, locale), total: formatNumber(c.seats_total, locale), left: formatNumber(seatsLeftOf(c.seats_total, taken), locale) })}
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip tone={TONE[c.status]}>{t(`cohorts.status.${c.status}`)}</StatusChip>
                    </td>
                    <td className="px-3 py-3">
                      <Button size="sm" variant="secondary" onClick={() => open(c)}>
                        {tc("edit")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

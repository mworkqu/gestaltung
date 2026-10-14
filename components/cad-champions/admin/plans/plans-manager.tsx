"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { savePlanAction } from "@/app/[locale]/cad-champions/admin/plans/actions";
import { BilingualField, CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, ConfirmDialog, EmptyState, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { priceChanged } from "@/lib/cad-champions/admin/plans-admin";
import { CC_PLAN_KINDS, type CcPlan, type CcPlanKind } from "@/lib/cad-champions/db/types";
import { formatNumber, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

import { FormErrors, SaveBar, formValues } from "./form-bits";

type Editing = CcPlan | "new" | null;

const selectCls = `${inputCls} pe-8`;

function priceFrom(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function PlansManager({ plans }: { plans: CcPlan[] }) {
  const t = useTranslations("CC.admin.plans");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [kind, setKind] = React.useState<CcPlanKind>("online");
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string> | null>(null);
  const [pending, setPending] = React.useState<Record<string, unknown> | null>(null);

  function open(next: Editing) {
    setEditing(next);
    setErrors(null);
    setKind(next && next !== "new" ? next.kind : "online");
  }

  async function save(values: Record<string, unknown>) {
    setSaving(true);
    setErrors(null);
    try {
      const r = await savePlanAction({ id: editing && editing !== "new" ? editing.id : null, values });
      if (r.ok) {
        toast.success(t("plans.saved"));
        setEditing(null);
        router.refresh();
      } else if (r.error === "invalid" && r.fields) setErrors(r.fields);
      else if (r.error === "conflict") setErrors({ slug: "taken" });
      else toast.error(tc(`errors.${r.error}`));
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e.currentTarget);
    if (editing && editing !== "new" && priceChanged(editing.price_qar, priceFrom(values.price_qar))) setPending(values);
    else void save(values);
  }

  const money = (n: number | string | null) => (n == null || n === "" ? t("plans.priceSoon") : formatQAR(Number(n), locale));
  const current = editing && editing !== "new" ? editing : null;

  return (
    <section aria-labelledby="plans-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-heading" className="title-section">
          {t("plans.heading")}
        </h2>
        {!editing ? <Button onClick={() => open("new")}>{t("plans.add")}</Button> : null}
      </div>
      <p className="text-sm text-body">{t("plans.intro")}</p>

      {editing ? (
        <form onSubmit={onSubmit} key={current?.id ?? "new"} className="neu space-y-5 p-5 sm:p-6">
          <h3 className="title-card">{current ? t("plans.editTitle", { name: locale === "ar" ? current.name_ar : current.name_en }) : t("plans.newTitle")}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("fields.slug")} hint={current ? t("fields.slugLocked") : t("fields.slugHint")}>
              <input name="slug" defaultValue={current?.slug ?? ""} readOnly={!!current} required={!current} dir="ltr" className={inputCls} maxLength={60} />
            </Field>
            <Field label={t("fields.kind")} hint={t(`plans.kindHelp.${kind}`)}>
              <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as CcPlanKind)} className={selectCls}>
                {CC_PLAN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`plans.kinds.${k}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <BilingualField label={t("fields.name")} required en={{ name: "name_en", defaultValue: current?.name_en }} ar={{ name: "name_ar", defaultValue: current?.name_ar }} maxLength={120} />
          <BilingualField label={t("fields.whoFor")} multiline rows={2} en={{ name: "who_for_en", defaultValue: current?.who_for_en ?? "" }} ar={{ name: "who_for_ar", defaultValue: current?.who_for_ar ?? "" }} maxLength={400} />
          <BilingualField
            label={t("fields.includes")}
            hint={t("fields.includesHint")}
            multiline
            rows={5}
            en={{ name: "includes_en", defaultValue: (current?.includes_en ?? []).join("\n") }}
            ar={{ name: "includes_ar", defaultValue: (current?.includes_ar ?? []).join("\n") }}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("fields.price")} hint={t("fields.priceHint")}>
              <input name="price_qar" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={current?.price_qar ?? ""} dir="ltr" className={inputCls} />
            </Field>
            <Field label={t("fields.duration")} hint={kind === "kit" ? t("fields.durationKit") : t("fields.durationHint")}>
              <input name="duration_days" type="number" inputMode="numeric" min={1} max={3650} step={1} defaultValue={current?.duration_days ?? ""} disabled={kind === "kit"} dir="ltr" className={inputCls} />
            </Field>
            <Field label={t("fields.sort")} hint={t("fields.sortHint")}>
              <input name="sort" type="number" inputMode="numeric" step={1} defaultValue={current?.sort ?? 0} dir="ltr" className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            <CheckboxField name="includes_in_person" label={t("fields.inPerson")} hint={t("fields.inPersonHint")} defaultChecked={current?.includes_in_person ?? false} />
            <CheckboxField name="is_featured" label={t("fields.featured")} defaultChecked={current?.is_featured ?? false} />
            <CheckboxField name="is_active" label={t("fields.active")} hint={t("fields.activeHint")} defaultChecked={current?.is_active ?? false} />
          </div>
          <FormErrors errors={errors} fieldLabel={(f) => t(`fields.labels.${f}`)} />
          <SaveBar saving={saving} onCancel={() => setEditing(null)} />
        </form>
      ) : null}

      {plans.length === 0 ? (
        <EmptyState icon={Package} title={t("plans.empty.title")} description={t("plans.empty.body")} />
      ) : (
        <div className="neu-inset overflow-x-auto p-1">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-start text-sm">
            <caption className="sr-only">{t("plans.heading")}</caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                {(["name", "kind", "price", "duration", "status"] as const).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                    {t(`plans.cols.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t("plans.cols.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink" dir="ltr">
                      {p.name_en}
                    </p>
                    <p className="text-body" dir="rtl">
                      {p.name_ar}
                    </p>
                    <p className="text-xs text-mutedtext">
                      <Ltr>{p.slug}</Ltr>
                    </p>
                  </td>
                  <td className="px-3 py-3">{t(`plans.kinds.${p.kind}`)}</td>
                  <td className="px-3 py-3 tabular-nums">{p.price_qar == null ? <StatusChip tone="warning">{t("plans.priceSoon")}</StatusChip> : money(p.price_qar)}</td>
                  <td className="px-3 py-3 tabular-nums">{p.duration_days == null ? "-" : t("plans.days", { count: formatNumber(p.duration_days, locale) })}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <StatusChip tone={p.is_active ? "success" : "neutral"}>{p.is_active ? t("plans.active") : t("plans.inactive")}</StatusChip>
                      {p.is_featured ? <StatusChip tone="info">{t("plans.featured")}</StatusChip> : null}
                      {p.includes_in_person ? <StatusChip tone="neutral">{t("plans.inPerson")}</StatusChip> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Button size="sm" variant="secondary" onClick={() => open(p)}>
                      {tc("edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => (o ? undefined : setPending(null))}
        title={t("plans.confirmPrice.title")}
        consequence={t("plans.confirmPrice.body", { plan: current ? (locale === "ar" ? current.name_ar : current.name_en) : "", from: money(current?.price_qar ?? null), to: money(pending ? priceFrom(pending.price_qar) : null) })}
        confirmLabel={t("plans.confirmPrice.action")}
        cancelLabel={tc("cancel")}
        onConfirm={() => (pending ? save(pending) : undefined)}
      />
    </section>
  );
}

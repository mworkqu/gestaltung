"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TicketPercent } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { saveCouponAction } from "@/app/[locale]/cad-champions/admin/plans/actions";
import { CheckboxField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button, EmptyState, StatusChip, useToast, type ChipTone } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { couponStatus, qatarDay, type CouponStatus } from "@/lib/cad-champions/admin/plans-admin";
import type { CcCoupon, CcDiscountType, CcPlan } from "@/lib/cad-champions/db/types";
import { formatDate, formatNumber, formatQAR } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";

import { FormErrors, SaveBar, formValues } from "./form-bits";

type Editing = CcCoupon | "new" | null;
const selectCls = `${inputCls} pe-8`;
const TONE: Record<CouponStatus, ChipTone> = { active: "success", inactive: "neutral", expired: "warning", used_up: "warning" };

export function CouponsManager({ coupons, plans }: { coupons: CcCoupon[]; plans: Pick<CcPlan, "id" | "name_en" | "name_ar" | "kind">[] }) {
  const t = useTranslations("CC.admin.plans");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [type, setType] = React.useState<CcDiscountType>("percent");
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string> | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  const [now] = React.useState(() => Date.now());

  function open(next: Editing) {
    setEditing(next);
    setErrors(null);
    setType(next && next !== "new" ? next.discount_type : "percent");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = formValues(e.currentTarget, ["plan_ids"]);
    setSaving(true);
    setErrors(null);
    try {
      const r = await saveCouponAction({ id: current?.id ?? null, values });
      if (r.ok) {
        toast.success(t("coupons.saved"));
        setEditing(null);
        router.refresh();
      } else if ((r.error === "invalid" || r.error === "conflict") && r.fields) setErrors(r.fields);
      else toast.error(tc(`errors.${r.error}`));
    } finally {
      setSaving(false);
    }
  }

  const planName = (id: string) => {
    const p = plans.find((x) => x.id === id);
    return p ? (locale === "ar" ? p.name_ar : p.name_en) : id.slice(0, 8);
  };
  const value = (c: CcCoupon) => (c.discount_type === "percent" ? `${formatNumber(Number(c.discount_value), locale)}%` : formatQAR(Number(c.discount_value), locale));

  return (
    <section aria-labelledby="coupons-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="coupons-heading" className="title-section">
          {t("coupons.heading")}
        </h2>
        {!editing ? <Button onClick={() => open("new")}>{t("coupons.add")}</Button> : null}
      </div>
      <p className="text-sm text-body">{t("coupons.intro")}</p>

      {editing ? (
        <form onSubmit={onSubmit} key={current?.id ?? "new"} className="neu space-y-5 p-5 sm:p-6">
          <h3 className="title-card">{current ? t("coupons.editTitle", { code: current.code }) : t("coupons.newTitle")}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("fields.code")} hint={t("fields.codeHint")}>
              <input name="code" defaultValue={current?.code ?? ""} required dir="ltr" className={`${inputCls} uppercase`} maxLength={32} autoCapitalize="characters" />
            </Field>
            <Field label={t("fields.discountType")}>
              <select name="discount_type" value={type} onChange={(e) => setType(e.target.value as CcDiscountType)} className={selectCls}>
                <option value="percent">{t("coupons.types.percent")}</option>
                <option value="fixed">{t("coupons.types.fixed")}</option>
              </select>
            </Field>
            <Field label={t("fields.discountValue")} hint={type === "percent" ? t("fields.valuePercentHint") : t("fields.valueFixedHint")}>
              <input name="discount_value" type="number" inputMode="decimal" min={0.01} max={type === "percent" ? 100 : 100000} step="0.01" defaultValue={current?.discount_value ?? ""} required dir="ltr" className={inputCls} />
            </Field>
            <Field label={t("fields.expires")} hint={t("fields.expiresHint")}>
              <input name="expires_at" type="date" defaultValue={qatarDay(current?.expires_at ?? null)} className={inputCls} />
            </Field>
            <Field label={t("fields.maxUses")} hint={t("fields.maxUsesHint")}>
              <input name="max_uses" type="number" inputMode="numeric" min={1} step={1} defaultValue={current?.max_uses ?? ""} dir="ltr" className={inputCls} />
            </Field>
            <Field label={t("fields.institution")} hint={t("fields.institutionHint")}>
              <input name="institution" defaultValue={current?.institution ?? ""} className={inputCls} maxLength={120} />
            </Field>
          </div>
          {current ? <p className="text-sm text-body">{t("coupons.usedReadOnly", { used: formatNumber(current.used_count, locale) })}</p> : null}
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold text-ink">{t("fields.plans")}</legend>
            <p className="text-xs text-mutedtext">{t("fields.plansHint")}</p>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {plans.map((p) => (
                <label key={p.id} className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
                  <input type="checkbox" name="plan_ids" value={p.id} defaultChecked={!!current?.plan_ids?.includes(p.id)} className="h-5 w-5 shrink-0 accent-[var(--accent,#0e59c5)]" />
                  {locale === "ar" ? p.name_ar : p.name_en}
                </label>
              ))}
            </div>
          </fieldset>
          <CheckboxField name="is_active" label={t("fields.active")} hint={t("coupons.activeHint")} defaultChecked={current?.is_active ?? true} />
          <FormErrors errors={errors} fieldLabel={(f) => t(`fields.labels.${f}`)} />
          <SaveBar saving={saving} onCancel={() => setEditing(null)} />
        </form>
      ) : null}

      {coupons.length === 0 ? (
        <EmptyState icon={TicketPercent} title={t("coupons.empty.title")} description={t("coupons.empty.body")} />
      ) : (
        <div className="neu-inset overflow-x-auto p-1">
          <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-start text-sm">
            <caption className="sr-only">{t("coupons.heading")}</caption>
            <thead>
              <tr className="text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                {(["code", "discount", "expires", "uses", "plans", "status"] as const).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                    {t(`coupons.cols.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t("plans.cols.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const st = couponStatus(c, now);
                return (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="px-3 py-3 font-semibold text-ink">
                      <Ltr as="code">{c.code}</Ltr>
                      {c.institution ? <p className="text-xs font-normal text-mutedtext">{c.institution}</p> : null}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{value(c)}</td>
                    <td className="px-3 py-3">{c.expires_at ? formatDate(c.expires_at, locale) : t("coupons.noExpiry")}</td>
                    <td className="px-3 py-3 tabular-nums">{c.max_uses == null ? t("coupons.usesUnlimited", { used: formatNumber(c.used_count, locale) }) : t("coupons.usesOf", { used: formatNumber(c.used_count, locale), max: formatNumber(c.max_uses, locale) })}</td>
                    <td className="px-3 py-3 text-body">{c.plan_ids && c.plan_ids.length > 0 ? c.plan_ids.map(planName).join(", ") : t("coupons.allPlans")}</td>
                    <td className="px-3 py-3">
                      <StatusChip tone={TONE[st]}>{t(`coupons.status.${st}`)}</StatusChip>
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

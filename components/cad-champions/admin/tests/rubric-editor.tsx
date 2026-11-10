"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ClipboardList, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { saveRubricAction, type Target } from "@/app/[locale]/cad-champions/admin/tests/content-actions";
import { BilingualField, Field, inputCls, textareaCls } from "@/components/cad-champions/admin/fields";
import { Button, ConfirmDialog, EmptyState, HelpTip, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { slugify } from "@/lib/cad-champions/admin/test-builder";
import { defaultRubric, parseRubric, rubricTotal, type Rubric, type RubricItem } from "@/lib/cad-champions/drawing/rubric";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { cn } from "@/lib/utils";

import { useAdminAction } from "./use-admin-action";

// Drawing rubric editor (Prompt 11 Step B, COMPETITION_ALIGNMENT section E).
// Saved to the row's `rubric`; the server then syncs one aspect per item
// (check key rubric:<id>), so marking follows the rubric.

type ItemState = Omit<RubricItem, "points"> & { points: string; isNew?: boolean };

const toState = (i: RubricItem): ItemState => ({ ...i, points: String(i.points) });
const ID_RE = /^[a-z0-9_]{1,40}$/;

function uniqueId(base: string, taken: Set<string>): string {
  const root = (slugify(base).replace(/-/g, "_") || "item").slice(0, 34);
  let id = root;
  let i = 2;
  while (taken.has(id)) id = `${root}_${i++}`;
  return id;
}

export function RubricEditor({ target, rubric, maxPoints }: { target: Target; rubric: unknown; maxPoints: number }) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy } = useAdminAction();
  const initial = parseRubric(rubric);
  const [kind, setKind] = React.useState<Rubric["kind"]>(initial?.kind ?? "part");
  const [items, setItems] = React.useState<ItemState[]>(() => (initial?.items ?? []).map(toState));
  const [open, setOpen] = React.useState<number | null>(null);
  const [confirmDefault, setConfirmDefault] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const n = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });

  const change = (next: ItemState[]) => {
    setItems(next);
    setDirty(true);
  };
  const update = (i: number, patch: Partial<ItemState>) => change(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
    setOpen(j);
  };

  const total = rubricTotal(items.map((i) => ({ points: Number(i.points) || 0 })));
  const ids = items.map((i) => i.id);
  const idProblem = ids.some((id, i) => !ID_RE.test(id) || ids.indexOf(id) !== i);
  const textProblem = items.some((i) => !i.text_en.trim() || !i.text_ar.trim() || !(Number(i.points) >= 0) || i.points.trim() === "");

  function loadDefault() {
    change(defaultRubric(kind).items.map(toState));
    setOpen(null);
    setConfirmDefault(false);
  }

  function addItem() {
    const id = uniqueId("item", new Set(ids));
    change([
      ...items,
      { id, isNew: true, type: "measurement", text_en: "", text_ar: "", student_hint_en: "", student_hint_ar: "", points: "1", check_type: "ai", applies: "both" },
    ]);
    setOpen(items.length);
  }

  async function save() {
    const payload: Rubric = {
      version: 1,
      kind,
      items: items.map(({ points, required, ai_guidance, ...withFlag }) => {
        const { isNew, ...rest } = withFlag;
        void isNew;
        return {
          ...rest,
          points: Number(points),
          check_type: rest.type === "judgement" ? "manual" : rest.check_type,
          ...(required === undefined ? {} : { required }),
          ...(ai_guidance?.trim() ? { ai_guidance: ai_guidance.trim() } : {}),
        };
      }),
    };
    const res = await run(() => saveRubricAction({ target, rubric: payload }), { success: t("rubric.saved"), successBody: t("rubric.savedBody") });
    if (res?.ok) {
      setDirty(false);
      setItems((prev) => prev.map((i) => ({ ...i, isNew: false })));
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t("rubric.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1 text-base font-bold text-heading">
          <ClipboardList aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          {t("rubric.title")}
          <HelpTip label={t("rubric.helpLabel")}>{t("rubric.help")}</HelpTip>
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            {t("rubric.kind")}
            <select
              className={cn(inputCls, "w-auto")}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Rubric["kind"]);
                setDirty(true);
              }}
            >
              <option value="part">{t("rubric.kinds.part")}</option>
              <option value="assembly">{t("rubric.kinds.assembly")}</option>
            </select>
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => (items.length > 0 ? setConfirmDefault(true) : loadDefault())}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            {t("rubric.loadDefault")}
          </Button>
        </div>
      </div>

      <p className={cn("text-sm", Math.abs(total - maxPoints) < 0.005 ? "text-mutedtext" : "font-semibold text-destructive")}>
        {t("rubric.total", { total: n(total), max: n(maxPoints) })}
      </p>

      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("rubric.emptyTitle")} description={t("rubric.emptyBody")} />
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <li key={`${it.id}-${i}`} className="tile flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="flex min-h-11 min-w-0 flex-1 flex-col items-start text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="text-sm font-semibold text-ink">{(locale === "ar" ? it.text_ar : it.text_en) || t("rubric.untitled")}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-mutedtext">
                      <StatusChip tone={it.type === "judgement" ? "warning" : "info"}>{t(`aspects.types.${it.type}`)}</StatusChip>
                      <span>{t("aspects.pointsShort", { points: n(Number(it.points) || 0) })}</span>
                      <span>{t(`rubric.checkTypes.${it.type === "judgement" ? "manual" : it.check_type}`)}</span>
                      <Ltr className="font-mono">{it.id}</Ltr>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="sm" aria-label={tc("moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" aria-label={tc("moveDown")} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" aria-label={t("rubric.remove")} onClick={() => change(items.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                </div>
                {isOpen ? (
                  <div className="flex flex-col gap-4">
                    <BilingualField label={t("rubric.text")} required maxLength={600} en={{ value: it.text_en, onChange: (v) => update(i, { text_en: v }) }} ar={{ value: it.text_ar, onChange: (v) => update(i, { text_ar: v }) }} />
                    <BilingualField label={t("rubric.hint")} hint={t("rubric.hintHint")} multiline rows={2} maxLength={600} en={{ value: it.student_hint_en, onChange: (v) => update(i, { student_hint_en: v }) }} ar={{ value: it.student_hint_ar, onChange: (v) => update(i, { student_hint_ar: v }) }} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <Field label={t("fields.type")}>
                        <select className={inputCls} value={it.type} onChange={(e) => update(i, { type: e.target.value as ItemState["type"], check_type: e.target.value === "judgement" ? "manual" : it.check_type })}>
                          <option value="measurement">{t("aspects.types.measurement")}</option>
                          <option value="judgement">{t("aspects.types.judgement")}</option>
                        </select>
                      </Field>
                      <Field label={t("fields.points")}>
                        <input className={inputCls} dir="ltr" inputMode="decimal" value={it.points} onChange={(e) => update(i, { points: e.target.value })} />
                      </Field>
                      <Field label={t("rubric.checkType")}>
                        <select className={inputCls} value={it.type === "judgement" ? "manual" : it.check_type} disabled={it.type === "judgement"} onChange={(e) => update(i, { check_type: e.target.value as ItemState["check_type"] })}>
                          <option value="ai">{t("rubric.checkTypes.ai")}</option>
                          <option value="manual">{t("rubric.checkTypes.manual")}</option>
                        </select>
                      </Field>
                      <Field label={t("rubric.applies")}>
                        <select className={inputCls} value={it.applies} onChange={(e) => update(i, { applies: e.target.value as ItemState["applies"] })}>
                          <option value="both">{t("rubric.appliesTo.both")}</option>
                          <option value="part">{t("rubric.appliesTo.part")}</option>
                          <option value="assembly">{t("rubric.appliesTo.assembly")}</option>
                        </select>
                      </Field>
                      <Field label={t("rubric.required")} hint={t("rubric.requiredHint")}>
                        <select
                          className={inputCls}
                          value={it.required === true ? "yes" : it.required === false ? "no" : it.required === null ? "unknown" : "always"}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next: Partial<ItemState> = { required: v === "yes" ? true : v === "no" ? false : v === "unknown" ? null : undefined };
                            update(i, next);
                          }}
                        >
                          <option value="always">{t("rubric.requiredOptions.always")}</option>
                          <option value="yes">{t("rubric.requiredOptions.yes")}</option>
                          <option value="no">{t("rubric.requiredOptions.no")}</option>
                          <option value="unknown">{t("rubric.requiredOptions.unknown")}</option>
                        </select>
                      </Field>
                    </div>
                    {it.isNew ? (
                      <Field label={t("rubric.id")} hint={t("rubric.idHint")}>
                        <input className={cn(inputCls, "font-mono")} dir="ltr" value={it.id} onChange={(e) => update(i, { id: e.target.value.toLowerCase() })} />
                      </Field>
                    ) : null}
                    {it.type === "measurement" && it.check_type === "ai" ? (
                      <Field label={t("rubric.aiGuidance")} hint={t("rubric.aiGuidanceHint")}>
                        <textarea className={cn(textareaCls, "min-h-16")} dir="ltr" lang="en" value={it.ai_guidance ?? ""} onChange={(e) => update(i, { ai_guidance: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {idProblem ? <p className="text-sm font-semibold text-destructive">{t("rubric.idProblem")}</p> : null}
      {textProblem ? <p className="text-sm text-mutedtext">{t("rubric.textProblem")}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={addItem}>
          <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          {t("rubric.addItem")}
        </Button>
        <Button type="button" onClick={save} loading={busy} loadingText={tc("saving")} disabled={idProblem || textProblem || !dirty} disabledReason={idProblem || textProblem ? t("rubric.fixFirst") : undefined}>
          {t("rubric.save")}
        </Button>
      </div>
      {dirty ? <p className="text-xs text-mutedtext">{t("rubric.unsaved")}</p> : null}

      <ConfirmDialog
        open={confirmDefault}
        onOpenChange={setConfirmDefault}
        title={t("rubric.defaultTitle")}
        consequence={t("rubric.defaultBody")}
        confirmLabel={t("rubric.loadDefault")}
        cancelLabel={tc("cancel")}
        tone="danger"
        onConfirm={loadDefault}
      />
    </section>
  );
}

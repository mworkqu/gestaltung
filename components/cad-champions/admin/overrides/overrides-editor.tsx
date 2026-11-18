"use client";

import * as React from "react";
import { ChevronDown, Pencil, RotateCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { BilingualField, CheckboxField, Field, hintCls, inputCls } from "@/components/cad-champions/admin/fields";
import { Alert, Button, EmptyState, StatusChip, useToast } from "@/components/cad-champions/ui";
import {
  dirtyEntries,
  filterGroups,
  isSafeMessageOverride,
  isValidVideoValue,
  type EditorValue,
  type OverrideEntry,
  type OverrideGroup,
  type OverrideItem,
} from "@/lib/cad-champions/admin/override-editor";
import type { ActionResult } from "@/lib/cad-champions/admin/server";
import { cn } from "@/lib/utils";

// Generic editor for cc_content_overrides (Get Ready, Glossary, Landing FAQ).
// Collapsible groups, a search box, the default EN/AR text next to every
// override field, one Save for all changes. An empty field = use the default
// (the row is deleted). Server validation is the authority; the live checks
// here only warn early.

type SaveFn = (entries: OverrideEntry[]) => Promise<ActionResult<{ saved: number }>>;

const EMPTY: EditorValue = { en: "", ar: "" };

function initialValues(groups: readonly OverrideGroup[]): Record<string, EditorValue> {
  const out: Record<string, EditorValue> = {};
  for (const g of groups) for (const i of g.items) out[i.key] = { en: i.en, ar: i.ar };
  return out;
}

function itemProblem(item: OverrideItem, v: EditorValue): "message" | "video" | null {
  if (item.kind === "video") return v.en.trim() !== "" && !isValidVideoValue(v.en.trim()) ? "video" : null;
  if (item.key.startsWith("msg:")) {
    if (v.en.trim() !== "" && !isSafeMessageOverride(item.defaultEn, v.en.trim())) return "message";
    if (v.ar.trim() !== "" && !isSafeMessageOverride(item.defaultAr || item.defaultEn, v.ar.trim())) return "message";
  }
  return null;
}

export function OverridesEditor({ groups, save, defaultOpenFirst = false }: { groups: OverrideGroup[]; save: SaveFn; defaultOpenFirst?: boolean }) {
  const t = useTranslations("CC.admin.getReady.editor");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();

  const allItems = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [base, setBase] = React.useState(() => initialValues(groups));
  const [values, setValues] = React.useState(() => initialValues(groups));
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(defaultOpenFirst && groups[0] ? [groups[0].id] : []));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Search runs over the saved + defaults + current edits so a hit is never hidden by its own typing.
  const shown = React.useMemo(() => {
    const live = groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, en: values[i.key]?.en ?? i.en, ar: values[i.key]?.ar ?? i.ar })) }));
    return filterGroups(live, query);
  }, [groups, values, query]);

  const dirty = React.useMemo(() => dirtyEntries(allItems, values, base), [allItems, values, base]);
  const problems = React.useMemo(() => allItems.filter((i) => itemProblem(i, values[i.key] ?? EMPTY) !== null).length, [allItems, values]);

  function setValue(key: string, patch: Partial<EditorValue>) {
    setValues((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY), ...patch } }));
  }
  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSave() {
    if (dirty.length === 0 || problems > 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await save(dirty);
      if (res.ok) {
        setBase((prev) => {
          const next = { ...prev };
          for (const e of dirty) next[e.key] = { en: e.en, ar: e.ar };
          return next;
        });
        setValues((prev) => {
          const next = { ...prev };
          for (const e of dirty) next[e.key] = { en: e.en, ar: e.ar };
          return next;
        });
        toast.success(tc("saved"));
      } else {
        setError(`${tc(`errors.${res.error}`)}${res.detail ? ` (${res.detail})` : ""}`);
        toast.error(tc(`errors.${res.error}`));
      }
    } catch {
      setError(tc("errors.error"));
      toast.error(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  const searching = query.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="neu flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label={t("search")} className="flex-1">
          <span className="relative block">
            <Search aria-hidden="true" strokeWidth={1.75} className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mutedtext" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} className={cn(inputCls, "ps-9")} />
          </span>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(new Set(shown.map((g) => g.id)))}>
            {t("expandAll")}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(new Set())}>
            {t("collapseAll")}
          </Button>
        </div>
      </div>

      {error ? <Alert tone="error" title={error} /> : null}

      {shown.length === 0 ? (
        <EmptyState icon={Search} title={t("noResults.title")} description={t("noResults.body")} />
      ) : (
        <ul className="space-y-3">
          {shown.map((g) => {
            const original = groups.find((x) => x.id === g.id) ?? g;
            const edited = original.items.filter((i) => {
              const v = values[i.key] ?? EMPTY;
              return v.en.trim() !== "" || v.ar.trim() !== "";
            }).length;
            const isOpen = searching || open.has(g.id);
            const panelId = `ov-${g.id}`;
            return (
              <li key={g.id} className="neu overflow-hidden">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(g.id)}
                  className="flex min-h-11 w-full items-center gap-3 p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <ChevronDown aria-hidden="true" strokeWidth={1.75} className={cn("h-4 w-4 shrink-0 text-mutedtext transition-transform motion-reduce:transition-none", isOpen ? "rotate-0" : "-rotate-90 rtl:rotate-90")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-heading">{g.title}</span>
                    {g.subtitle ? <span className="block truncate text-xs text-mutedtext">{g.subtitle}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-mutedtext">{t("groupCount", { total: String(original.items.length) })}</span>
                  {edited > 0 ? (
                    <StatusChip tone="info" icon={Pencil}>
                      {t("editedCount", { count: String(edited) })}
                    </StatusChip>
                  ) : null}
                </button>
                {isOpen ? (
                  <div id={panelId} className="space-y-4 border-t border-border p-4">
                    {g.items.map((item) => (
                      <ItemEditor key={item.key} item={item} value={values[item.key] ?? EMPTY} onChange={(p) => setValue(item.key, p)} />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-neu-sm" role="region" aria-label={t("saveBar")}>
        <p aria-live="polite" className="flex-1 text-sm text-body">
          {problems > 0 ? t("problems", { count: String(problems) }) : dirty.length > 0 ? t("unsaved", { count: String(dirty.length) }) : t("noChanges")}
        </p>
        <Button type="button" onClick={onSave} loading={saving} loadingText={tc("saving")} disabled={dirty.length === 0 || problems > 0} disabledReason={problems > 0 ? t("problems", { count: String(problems) }) : t("noChanges")}>
          {t("saveChanges")}
        </Button>
      </div>
    </div>
  );
}

function ItemEditor({ item, value, onChange }: { item: OverrideItem; value: EditorValue; onChange: (p: Partial<EditorValue>) => void }) {
  const t = useTranslations("CC.admin.getReady.editor");
  const tc = useTranslations("CC.admin.common");
  const problem = itemProblem(item, value);
  const hasOverride = value.en.trim() !== "" || value.ar.trim() !== "";

  if (item.kind === "flag") {
    return (
      <div className="tile">
        <CheckboxField label={item.label} hint={item.hint} checked={value.en.trim() === "1"} onChange={(v) => onChange({ en: v ? "1" : "", ar: v ? "1" : "" })} />
      </div>
    );
  }

  if (item.kind === "video") {
    return (
      <div className="tile space-y-2">
        <Field label={item.label} hint={item.hint}>
          <input
            type="text"
            dir="ltr"
            value={value.en}
            onChange={(e) => onChange({ en: e.target.value, ar: e.target.value })}
            placeholder={t("videoPlaceholder")}
            aria-invalid={problem === "video"}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          {problem === "video" ? <p role="alert" className="text-xs font-semibold text-[#a1231f]">{t("badVideo")}</p> : <p className={hintCls}>{t("videoHelp")}</p>}
          {hasOverride ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ en: "", ar: "" })}>
              <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {tc("useDefault")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tile space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs font-semibold text-mutedtext" dir="ltr">
          {item.label}
        </span>
        {hasOverride ? <StatusChip tone="info" icon={Pencil}>{t("edited")}</StatusChip> : null}
        {hasOverride ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ en: "", ar: "" })}>
            <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {tc("useDefault")}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <p className="min-w-0 rounded-xl bg-panel p-3 text-xs leading-relaxed text-body" lang="en" dir="ltr">
          <span className="mb-1 block font-semibold text-mutedtext">{tc("defaultText")} · {tc("english")}</span>
          {item.defaultEn}
        </p>
        <p className="min-w-0 rounded-xl bg-panel p-3 text-xs leading-relaxed text-body" lang="ar" dir="rtl">
          <span className="mb-1 block font-semibold text-mutedtext">{tc("defaultText")} · {tc("arabic")}</span>
          {item.defaultAr}
        </p>
      </div>
      <BilingualField
        label={t("overrideField")}
        multiline={item.kind === "textarea"}
        rows={3}
        en={{ value: value.en, onChange: (v) => onChange({ en: v }), placeholder: item.defaultEn }}
        ar={{ value: value.ar, onChange: (v) => onChange({ ar: v }), placeholder: item.defaultAr }}
      />
      {problem === "message" ? (
        <p role="alert" className="text-xs font-semibold text-[#a1231f]">
          {t("badMessage")}
        </p>
      ) : null}
    </div>
  );
}

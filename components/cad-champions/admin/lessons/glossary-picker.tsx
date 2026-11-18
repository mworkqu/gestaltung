"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { inputCls } from "@/components/cad-champions/admin/fields";
import { GLOSSARY, GLOSSARY_IDS, type GlossaryId } from "@/lib/cad-champions/glossary";
import { Ltr } from "@/lib/cad-champions/ltr";

// Pick glossary terms (ids from lib/cad-champions/glossary.ts): selected
// terms show as removable chips; a search box filters the full list by id or
// by the English / Arabic term.

export function GlossaryPicker({ label, selected, onChange }: { label: string; selected: string[]; onChange: (next: string[]) => void }) {
  const t = useTranslations("CC.admin.lessons");
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const rows = React.useMemo(
    () =>
      GLOSSARY_IDS.filter((id) => {
        if (!needle) return true;
        const e = GLOSSARY[id];
        return id.includes(needle) || e.en.term.toLowerCase().includes(needle) || e.ar.term.includes(needle);
      }),
    [needle],
  );
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const searchId = React.useId();

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      {selected.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("glossary.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={t("glossary.selected")}>
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-panel px-3 text-xs font-semibold text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t("glossary.remove", { term: id })}
              >
                <Ltr>{id}</Ltr>
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={searchId} className="sr-only">
        {t("glossary.search")}
      </label>
      <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("glossary.search")} className={inputCls} />
      <ul className="max-h-60 overflow-y-auto rounded-xl border border-border">
        {rows.length === 0 ? <li className="p-3 text-sm text-mutedtext">{t("glossary.noMatch")}</li> : null}
        {rows.map((id: GlossaryId) => (
          <li key={id} className="border-b border-border last:border-b-0">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-panel">
              <input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} className="h-5 w-5 shrink-0 accent-[var(--accent,#0e59c5)]" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink">{GLOSSARY[id].en.term}</span>
                <span className="ms-2 text-mutedtext" lang="ar" dir="rtl">
                  {GLOSSARY[id].ar.term}
                </span>
              </span>
              <Ltr className="font-mono text-xs text-mutedtext">{id}</Ltr>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

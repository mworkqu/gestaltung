"use client";

// Fill product attributes: one row per product (class, its fields, pack size),
// a category filter, and bulk edit for the selected rows — set the class, or
// one field, on many products at once. Plus the kit discount.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Save } from "lucide-react";

import {
  bulkSetAttributes,
  saveKitDiscount,
  savePartAttributes,
} from "@/app/[locale]/dashboard/store/attributes/actions";
import {
  ATTR_CLASSES,
  fieldsOf,
  formatValue,
  isAttrClass,
  isComplete,
  type Attributes,
  type Field,
} from "@/lib/store/attributes";
import { cn } from "@/lib/utils";

export type EditablePart = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  category: string;
  attributes: Attributes | null;
  pack_size: number | null;
  is_published: boolean;
};

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (f.options && f.type !== "list")
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={input}>
        <option value="">—</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  return (
    <input
      value={Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={f.type === "list" ? (f.options ?? []).slice(0, 3).join(", ") : f.unit ? `${f.unit === "Ω" ? "10k" : f.unit === "F" ? "100n" : "0"} ${f.unit}` : ""}
      className={input}
      dir="ltr"
    />
  );
}

function PartRow({
  p,
  locale,
  selected,
  onSelect,
}: {
  p: EditablePart;
  locale: string;
  selected: boolean;
  onSelect: (v: boolean) => void;
}) {
  const t = useTranslations("StoreAttributes");
  const [attrs, setAttrs] = useState<Attributes>(p.attributes ?? {});
  const [pack, setPack] = useState(p.pack_size ?? 1);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const cls = isAttrClass(attrs.class) ? attrs.class : null;

  async function save() {
    setState("saving");
    const r = await savePartAttributes(locale, p.id, attrs, pack);
    setState("error" in r ? "error" : "saved");
  }

  return (
    <tr className="align-top">
      <td className="px-2 py-2">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={p.sku} />
      </td>
      <td className="px-2 py-2">
        <span className="block text-[12.5px] font-semibold text-heading">{p.name}</span>
        <span className="font-mono text-[10px] text-faint">{p.sku}</span>
        {isComplete(p.attributes) ? (
          <span className="ms-2 text-[10px] font-semibold text-buy">{t("complete")}</span>
        ) : (
          <span className="ms-2 text-[10px] font-semibold text-inventory">{t("incomplete")}</span>
        )}
      </td>
      <td className="min-w-[130px] px-2 py-2">
        <select
          value={cls ?? ""}
          onChange={(e) => setAttrs(e.target.value ? { class: e.target.value } : {})}
          className={input}
        >
          <option value="">{t("noClass")}</option>
          {ATTR_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t(`class_${c}`)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        {cls ? (
          <div className="grid min-w-[360px] grid-cols-2 gap-1.5 lg:grid-cols-3">
            {fieldsOf(cls).map((f) => (
              <label key={f.key} className="flex flex-col gap-0.5">
                <span className="text-[9.5px] uppercase tracking-wider text-faint">
                  {f.key.replace(/_/g, " ")}
                  {f.required && <span className="text-destructive"> *</span>}
                </span>
                <FieldInput f={f} value={attrs[f.key]} onChange={(v) => setAttrs((a) => ({ ...a, [f.key]: v }))} />
              </label>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-mutedtext">{t("pickClass")}</span>
        )}
      </td>
      <td className="w-20 px-2 py-2">
        <input type="number" min={1} value={pack} onChange={(e) => setPack(Number(e.target.value) || 1)} className={input} dir="ltr" />
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="inline-flex items-center gap-1 rounded-lg bg-cobalt px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
        >
          {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : state === "saved" ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          {state === "saved" ? t("saved") : t("save")}
        </button>
        {state === "error" && <p className="mt-1 text-[10.5px] text-destructive">{t("saveFailed")}</p>}
      </td>
    </tr>
  );
}

export function AttributesEditor({
  locale,
  parts,
  kitDiscountPct,
  settingsReady,
}: {
  locale: string;
  parts: EditablePart[];
  kitDiscountPct: number;
  settingsReady: boolean;
}) {
  const t = useTranslations("StoreAttributes");
  const categories = useMemo(() => [...new Set(parts.map((p) => p.category))], [parts]);
  const [category, setCategory] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkClass, setBulkClass] = useState("");
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkPack, setBulkPack] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [kit, setKit] = useState(String(kitDiscountPct));
  const [kitState, setKitState] = useState<"idle" | "saved" | "error">("idle");

  const shown = parts.filter(
    (p) => (!category || p.category === category) && (!onlyIncomplete || !isComplete(p.attributes))
  );
  const bulkFields = isAttrClass(bulkClass) ? fieldsOf(bulkClass) : [];

  function applyBulk() {
    const ids = [...selected];
    if (!ids.length) return;
    start(async () => {
      const r = await bulkSetAttributes(locale, ids, {
        class: bulkClass || undefined,
        field: bulkField || undefined,
        value: bulkField ? bulkValue : undefined,
        packSize: bulkPack ? Number(bulkPack) : undefined,
      });
      setMsg("error" in r ? t("saveFailed") : t("bulkDone", { count: r.count ?? 0 }));
    });
  }

  return (
    <div className="space-y-4">
      <section className="neu flex flex-wrap items-end gap-3 p-5">
        <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
          {t("kitDiscount")}
          <span className="flex items-center gap-1">
            <input type="number" min={0} max={90} value={kit} onChange={(e) => setKit(e.target.value)} className={cn(input, "w-24")} dir="ltr" />
            <span className="text-sm text-heading">%</span>
          </span>
        </label>
        <button
          type="button"
          disabled={!settingsReady}
          onClick={async () => {
            const r = await saveKitDiscount(locale, Number(kit));
            setKitState("error" in r ? "error" : "saved");
          }}
          className="rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover disabled:opacity-50"
        >
          {kitState === "saved" ? t("saved") : t("save")}
        </button>
        <p className="max-w-[48ch] text-[11.5px] text-mutedtext">{t("kitDiscountNote")}</p>
        {kitState === "error" && <p className="text-[11px] text-destructive">{t("saveFailed")}</p>}
      </section>

      <section className="neu space-y-3 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
            {t("category")}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(input, "w-48")}>
              <option value="">{t("allCategories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-heading">
            <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
            {t("onlyIncomplete")}
          </label>
          <button
            type="button"
            onClick={() => setSelected(new Set(shown.map((p) => p.id)))}
            className="text-[12px] font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("selectShown", { count: shown.length })}
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} className="text-[12px] text-mutedtext hover:text-heading">
              {t("clearSelection")}
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-panel/60 p-3">
            <span className="text-[12px] font-semibold text-heading">{t("bulkFor", { count: selected.size })}</span>
            <select value={bulkClass} onChange={(e) => { setBulkClass(e.target.value); setBulkField(""); }} className={cn(input, "w-40")}>
              <option value="">{t("keepClass")}</option>
              {ATTR_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {t(`class_${c}`)}
                </option>
              ))}
            </select>
            {bulkFields.length > 0 && (
              <select value={bulkField} onChange={(e) => setBulkField(e.target.value)} className={cn(input, "w-40")}>
                <option value="">{t("noField")}</option>
                {bulkFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.key.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            )}
            {bulkField && (
              <div className="w-40">
                <FieldInput f={bulkFields.find((f) => f.key === bulkField)!} value={bulkValue} onChange={(v) => setBulkValue(String(v))} />
              </div>
            )}
            <input type="number" min={1} placeholder={t("packSize")} value={bulkPack} onChange={(e) => setBulkPack(e.target.value)} className={cn(input, "w-28")} dir="ltr" />
            <button
              type="button"
              onClick={applyBulk}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("apply")}
            </button>
            {msg && <span className="text-[11.5px] text-mutedtext">{msg}</span>}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-faint">
                <th className="px-2 pb-2" />
                <th className="px-2 pb-2 text-start font-medium">{t("colProduct")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colClass")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("colAttributes")}</th>
                <th className="px-2 pb-2 text-start font-medium">{t("packSize")}</th>
                <th className="px-2 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borderstrong/40">
              {shown.map((p) => (
                <PartRow
                  key={`${p.id}:${JSON.stringify(p.attributes)}:${p.pack_size}`}
                  p={p}
                  locale={locale}
                  selected={selected.has(p.id)}
                  onSelect={(v) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (v) n.add(p.id);
                      else n.delete(p.id);
                      return n;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10.5px] text-mutedtext">{t("unitsNote", { example: formatValue(10000, "Ω") })}</p>
      </section>
    </div>
  );
}

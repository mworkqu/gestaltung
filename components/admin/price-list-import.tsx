"use client";

// Supplier price-list import (Task 19a): pick a supplier and its CSV, map the
// columns (remembered per supplier), preview exactly what will change, apply.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, FileUp, Loader2 } from "lucide-react";

import {
  applyImport,
  previewImport,
  type ApplyResult,
  type ImportPlan,
} from "@/app/[locale]/dashboard/store/suppliers/import/actions";
import {
  OFFER_FIELDS,
  guessMapping,
  readCsv,
  toOffers,
  type ColumnMapping,
  type CsvReadResult,
} from "@/lib/sourcing/adapters/csv";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const btn =
  "inline-flex items-center gap-1.5 rounded-full bg-cobalt px-5 py-2 text-sm font-semibold text-white disabled:opacity-50";

export function PriceListImport({
  locale,
  suppliers,
  savedMappings,
}: {
  locale: string;
  suppliers: Supplier[];
  savedMappings: Record<string, ColumnMapping>;
}) {
  const t = useTranslations("PriceImport");
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvReadResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [drafts, setDrafts] = useState(false);
  const [done, setDone] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const supplier = suppliers.find((s) => s.id === supplierId);

  const parsed = useMemo(() => (csv ? toOffers(csv, mapping) : null), [csv, mapping]);

  function onSupplier(id: string) {
    setSupplierId(id);
    setPlan(null);
    setDone(null);
    const s = suppliers.find((x) => x.id === id);
    if (csv && s) setMapping(guessMapping(csv.headers, savedMappings[s.code]));
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setPlan(null);
    setDone(null);
    if (f.size > 10 * 1024 * 1024) return setError(t("tooBig"));
    const read = readCsv(await f.text());
    if (!read.headers.length) return setError(t("empty"));
    setFileName(f.name);
    setCsv(read);
    setMapping(guessMapping(read.headers, supplier ? savedMappings[supplier.code] : null));
  }

  const preview = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const r = await previewImport(supplierId, parsed?.offers ?? []);
      if ("error" in r) setError(r.error);
      else setPlan(r);
    });

  const apply = () =>
    start(async () => {
      const r = await applyImport(locale, supplierId, parsed?.offers ?? [], mapping, drafts);
      if ("error" in r) setError(r.error);
      else {
        setDone(r);
        setPlan(null);
        router.refresh();
      }
    });

  const fmt = (v: string | number | null) => (v === null || v === "" ? "—" : String(v));

  return (
    <div className="space-y-5">
      {/* 1. Supplier + file */}
      <div className="neu grid grid-cols-1 gap-4 p-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-end">
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("supplier")}</span>
          <select value={supplierId} onChange={(e) => onSupplier(e.target.value)} className={input}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-borderstrong px-4 py-3 text-sm text-body hover:border-cobalt">
          <FileUp className="h-5 w-5 text-cobalt" />
          <span className="min-w-0 truncate">{fileName ?? t("chooseFile")}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      {/* 2. Mapping */}
      {csv && (
        <div className="neu space-y-4 p-5">
          <div>
            <h2 className="text-base font-bold text-heading">{t("mapTitle")}</h2>
            <p className="mt-1 text-xs text-mutedtext">{t("mapHelp", { rows: csv.rows.length })}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OFFER_FIELDS.map((f) => (
              <label key={f} className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">
                  {t(`f_${f}`)}
                  {f === "supplierSku" && <span className="text-destructive"> *</span>}
                </span>
                <select
                  value={mapping[f] ?? ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [f]: e.target.value || undefined });
                    setPlan(null);
                  }}
                  className={input}
                >
                  <option value="">{t("notInFile")}</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {parsed && (
            <p className="text-sm text-body">
              {t("readSummary", { ok: parsed.offers.length, bad: parsed.errors.length })}
              {parsed.errors.length > 0 && (
                <span className="block text-xs text-mutedtext">
                  {parsed.errors
                    .slice(0, 6)
                    .map((e) => t(`err_${e.reason}`, { row: e.row, field: e.field ? t(`f_${e.field}`) : "" }))
                    .join(" · ")}
                  {parsed.errors.length > 6 && " …"}
                </span>
              )}
            </p>
          )}
          <button type="button" onClick={preview} disabled={pending || !mapping.supplierSku || !parsed?.offers.length} className={btn}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {t("preview")}
          </button>
        </div>
      )}

      {/* 3. Plan */}
      {plan && (
        <div className="neu space-y-5 p-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <Chip>{t("sumUpdates", { n: plan.updates.length })}</Chip>
            <Chip>{t("sumUnchanged", { n: plan.unchanged })}</Chip>
            <Chip>{t("sumAttach", { n: plan.attach.length })}</Chip>
            <Chip>{t("sumUnmatched", { n: plan.unmatched.length })}</Chip>
          </div>
          {plan.supplier.mirror && <p className="text-xs text-mutedtext">{t("mirrorNote", { supplier: plan.supplier.name })}</p>}

          {plan.updates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                    <th className="px-2 py-1.5 text-start">{t("colProduct")}</th>
                    <th className="px-2 py-1.5 text-start">{t("f_supplierSku")}</th>
                    <th className="px-2 py-1.5 text-start">{t("colChanges")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.updates.slice(0, 300).map((u) => (
                    <tr key={u.offerId} className="border-t border-borderstrong/40 align-top">
                      <td className="px-2 py-1.5 text-heading">{u.partName}</td>
                      <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">
                        {u.supplierSku}
                      </td>
                      <td className="px-2 py-1.5">
                        {u.changes.map((c) => (
                          <span key={c.field} className="me-3 inline-block whitespace-nowrap tabular-nums">
                            <span className="text-mutedtext">{t(`c_${c.field}`)}:</span> {fmt(c.from)} → <b>{fmt(c.to)}</b>
                            {c.field === "cost" && typeof c.from === "number" && c.from > 0 && (
                              <span className={cn("ms-1 text-xs", Number(c.to) > c.from ? "text-red-700" : "text-emerald-700")}>
                                ({Number(c.to) > c.from ? "+" : ""}
                                {(((Number(c.to) - c.from) / c.from) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.updates.length > 300 && <p className="mt-1 text-xs text-mutedtext">{t("more", { n: plan.updates.length - 300 })}</p>}
            </div>
          )}

          {plan.attach.length > 0 && (
            <p className="text-sm text-body">
              {t("attachList")}{" "}
              {plan.attach
                .slice(0, 12)
                .map((a) => `${a.partName} (${a.partSku})`)
                .join(", ")}
              {plan.attach.length > 12 && " …"}
            </p>
          )}

          {plan.unmatched.length > 0 && (
            <div className="space-y-2 rounded-xl bg-panel p-3 text-sm">
              <p className="text-body">{t("unmatchedHelp", { n: plan.unmatched.length })}</p>
              <p className="text-xs text-mutedtext">
                {plan.unmatched
                  .slice(0, 12)
                  .map((u) => u.offer.name ?? u.offer.supplierSku)
                  .join(", ")}
                {plan.unmatched.length > 12 && " …"}
              </p>
              <label className="flex items-center gap-2 text-heading">
                <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} />
                {t("createDrafts")}
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={apply}
            disabled={pending || (!plan.updates.length && !plan.attach.length && !(drafts && plan.unmatched.length) && !plan.unchanged)}
            className={btn}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("apply")}
          </button>
        </div>
      )}

      {done && (
        <div className="neu space-y-1 p-5 text-sm">
          <p className="font-semibold text-emerald-700">
            {t("doneSummary", { updated: done.updated, attached: done.attached, drafts: done.drafts })}
          </p>
          {done.failed.length > 0 && (
            <p className="text-destructive">
              {t("doneFailed", { n: done.failed.length })}{" "}
              {done.failed
                .slice(0, 8)
                .map((f) => `${f.supplierSku}${f.reason === "no_name" ? ` (${t("noName")})` : ""}`)
                .join(", ")}
            </p>
          )}
          <p className="text-xs text-mutedtext">{t("mappingSaved")}</p>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-panel px-3 py-1 font-medium text-heading shadow-neu-sm">{children}</span>;
}

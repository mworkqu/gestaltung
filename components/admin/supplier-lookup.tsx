"use client";

// Find parts at Mouser and DigiKey (Task 19b) and bring them into the store:
// as a new product (name, description, photo and specifications from the
// supplier's API; price and category from you) or as another supplier offer on
// a product we already have.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, ExternalLink, Link2, Loader2, Plus, Search } from "lucide-react";

import { addFromSupplier, searchSuppliers, type LookupResult } from "@/app/[locale]/dashboard/store/suppliers/lookup/actions";
import { formatValue, isAttrClass, fieldsOf } from "@/lib/store/attributes";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

type Pricing = { usdToQar: number; overheadPct: Record<string, number>; markup: number };

export function SupplierLookup({
  locale,
  categories,
  pricing,
  configured,
}: {
  locale: string;
  categories: string[];
  pricing: Pricing;
  configured: { mouser: boolean; digikey: boolean };
}) {
  const t = useTranslations("SupplierLookup");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [errors, setErrors] = useState<{ supplier: string; message: string }[]>([]);
  const [pending, start] = useTransition();

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await searchSuppliers(q);
      setResults(r.results);
      setErrors(r.errors);
    });
  };

  return (
    <div className="space-y-5">
      <form onSubmit={search} className="neu flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mutedtext" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("placeholder")}
            className={cn(input, "ps-9 text-base")}
            dir="ltr"
          />
        </div>
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t("search")}
        </button>
        <p className="w-full text-[11px] text-mutedtext">
          {t("sources", {
            mouser: configured.mouser ? t("on") : t("off"),
            digikey: configured.digikey ? t("on") : t("off"),
          })}
        </p>
      </form>

      {errors.map((e) => (
        <p key={e.supplier} className="text-sm text-amber-700">
          {t("supplierError", { supplier: e.supplier === "mouser" ? "Mouser" : "DigiKey", message: e.message })}
        </p>
      ))}

      {results && results.length === 0 && <p className="text-sm text-mutedtext">{t("noResults")}</p>}

      {results && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <ResultRow key={`${r.supplierCode}|${r.supplierSku}`} r={r} locale={locale} categories={categories} pricing={pricing} />
          ))}
        </ul>
      )}

      <datalist id="lookup-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function ResultRow({ r, locale, categories, pricing }: { r: LookupResult; locale: string; categories: string[]; pricing: Pricing }) {
  const t = useTranslations("SupplierLookup");
  const tD = useTranslations("Delivery");
  const landed =
    r.cost === null ? null : Math.round(r.cost * (r.currency === "QAR" ? 1 : pricing.usdToQar) * (1 + (pricing.overheadPct[r.supplierCode] ?? 0) / 100) * 100) / 100;
  const suggested = landed === null ? "" : String(Math.max(1, Math.ceil(landed * (1 + pricing.markup / 100) * 2) / 2));
  const [mode, setMode] = useState<"none" | "new" | "link">("none");
  const [category, setCategory] = useState(categories.includes("Components") ? "Components" : categories[0] ?? "Components");
  const [price, setPrice] = useState(suggested);
  const [sku, setSku] = useState("");
  const [publish, setPublish] = useState(false);
  const [done, setDone] = useState<{ partSku: string; partId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cls = isAttrClass(r.attributes.class) ? r.attributes.class : null;
  const specs = cls
    ? fieldsOf(cls)
        .filter((f) => r.attributes[f.key] !== undefined)
        .map((f) => `${f.key.replace(/_/g, " ")} ${formatValue(r.attributes[f.key], f.unit)}`)
    : [];
  const leadClass =
    r.leadTimeDays === null ? null : r.leadTimeDays <= 2 ? "in_stock" : r.leadTimeDays <= 5 ? "3_5_days" : r.leadTimeDays <= 14 ? "1_2_weeks" : "2_4_weeks";

  const save = () =>
    start(async () => {
      setError(null);
      const res = await addFromSupplier(locale, {
        supplier: r.supplierCode,
        supplierSku: r.supplierSku,
        ...(mode === "link" ? { existingSku: sku } : { category, price: Number(price), publish }),
      });
      if ("error" in res) setError(t.has(`err_${res.error}`) ? t(`err_${res.error}`) : res.error);
      else setDone({ partSku: res.partSku, partId: res.partId });
    });

  return (
    <li className="neu flex flex-col gap-3 p-4 sm:flex-row">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white">
        {r.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", r.supplierCode === "mouser" ? "bg-sky-500/10 text-sky-700" : "bg-red-500/10 text-red-700")}>
            {r.supplierCode === "mouser" ? "Mouser" : "DigiKey"}
          </span>
          <span className="font-semibold text-heading" dir="ltr">
            {r.manufacturer} {r.mpn}
          </span>
          <span className="font-mono text-[11px] text-mutedtext" dir="ltr">
            {r.supplierSku}
          </span>
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" className="text-cobalt" aria-label={t("openAtSupplier")}>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <p className="text-sm text-body">{r.description}</p>
        <p className="text-[12px] tabular-nums text-mutedtext">
          {r.cost !== null ? `${r.cost} ${r.currency}` : t("noPrice")}
          {landed !== null && ` · ${t("landed", { qar: landed.toFixed(2) })}`}
          {` · ${t(`av_${r.availability}`)}`}
          {leadClass && ` · ${tD(`lt_${leadClass}`)}`}
          {r.moq > 1 && ` · ${t("moq", { n: r.moq })}`}
        </p>
        {specs.length > 0 && <p className="text-[12px] text-heading">{t("specs", { cls: cls!, list: specs.join(" · ") })}</p>}

        {r.linked || done ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" />
            <Link href={`/dashboard/store/${(done ?? r.linked)!.partId}/edit`} className="hover:underline">
              {t("inStore", { sku: (done?.partSku ?? r.linked!.partSku) })}
            </Link>
          </p>
        ) : mode === "none" ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => setMode("new")} className="inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1 text-[12px] font-semibold text-white">
              <Plus className="h-3.5 w-3.5" /> {t("addNew")}
            </button>
            <button type="button" onClick={() => setMode("link")} className="inline-flex items-center gap-1 rounded-full border border-borderstrong px-3 py-1 text-[12px] font-medium text-heading hover:border-cobalt">
              <Link2 className="h-3.5 w-3.5" /> {t("linkExisting")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-panel p-3">
            {mode === "new" ? (
              <>
                <label className="block w-40 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("category")}</span>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} list="lookup-categories" className={input} />
                </label>
                <label className="block w-28 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("price")}</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={input} dir="ltr" />
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-[12px] text-body">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> {t("publish")}
                </label>
              </>
            ) : (
              <label className="block w-40 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("ourSku")}</span>
                <input value={sku} onChange={(e) => setSku(e.target.value)} className={input} dir="ltr" />
              </label>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending || (mode === "link" ? !sku.trim() : price === "")}
              className="inline-flex items-center gap-1 rounded-full bg-cobalt px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === "link" ? t("link") : t("add")}
            </button>
            <button type="button" onClick={() => setMode("none")} className="pb-1.5 text-[12px] text-mutedtext hover:text-heading">
              {t("cancel")}
            </button>
            {mode === "new" && landed !== null && <p className="w-full text-[11px] text-mutedtext">{t("priceHint", { markup: pricing.markup })}</p>}
            {error && <p className="w-full text-[12px] text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

"use client";

// Suppliers (pricing mode, commission, landed overhead, currency) and the
// sourcing settings (margin floor, exchange rates to QAR). Saving settings
// re-derives every product's income and floor flag.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save } from "lucide-react";

import { saveSourcingSettings, saveSupplier, type SupplierInput } from "@/app/[locale]/dashboard/store/sourcing/actions";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

const blank: SupplierInput = {
  code: "",
  name: "",
  default_pricing_mode: "markup",
  commission_percent: "",
  landed_overhead_pct: 0,
  default_currency: "USD",
  active: true,
};

export function SuppliersEditor({
  locale,
  suppliers,
  offerCounts,
  floorPct,
  fx,
}: {
  locale: string;
  suppliers: Supplier[];
  offerCounts: Record<string, number>;
  floorPct: number;
  fx: Record<string, number>;
}) {
  const t = useTranslations("Sourcing");
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-8">
      <div className="neu overflow-x-auto p-4">
        <table className="w-full min-w-[820px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-borderstrong/60 text-[10px] uppercase tracking-wider text-mutedtext">
              {["s_code", "s_name", "s_mode", "s_commission", "s_overhead", "s_currency", "s_offers", "active", ""].map((k) => (
                <th key={k} className="px-2 py-2 text-start font-semibold">
                  {k ? t(k) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <SupplierRow key={s.id} locale={locale} initial={{ ...s, commission_percent: s.commission_percent ?? "" }} offers={offerCounts[s.id] ?? 0} />
            ))}
            {adding && <SupplierRow locale={locale} initial={blank} onDone={() => setAdding(false)} />}
          </tbody>
        </table>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt"
          >
            <Plus className="h-4 w-4" /> {t("addSupplier")}
          </button>
        )}
      </div>

      <Settings locale={locale} floorPct={floorPct} fx={fx} />
    </div>
  );
}

function SupplierRow({
  locale,
  initial,
  offers,
  onDone,
}: {
  locale: string;
  initial: SupplierInput;
  offers?: number;
  onDone?: () => void;
}) {
  const t = useTranslations("Sourcing");
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof SupplierInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((cur) => ({ ...cur, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const save = () =>
    start(async () => {
      const r = await saveSupplier(locale, v);
      if (r.error) setMsg(r.error === "duplicate" ? t("errorDuplicate") : r.error === "required" ? t("errorRequired") : r.error);
      else {
        setMsg(null);
        onDone?.();
        router.refresh();
      }
    });

  return (
    <tr className="border-b border-borderstrong/40 align-top">
      <td className="px-1 py-2">
        <input value={v.code} onChange={set("code")} disabled={!!initial.id} className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={v.name} onChange={set("name")} className={input} />
      </td>
      <td className="px-1 py-2">
        <select value={v.default_pricing_mode} onChange={set("default_pricing_mode")} className={input}>
          <option value="markup">{t("mode_markup")}</option>
          <option value="mirror">{t("mode_mirror")}</option>
        </select>
      </td>
      <td className="px-1 py-2">
        <input value={String(v.commission_percent ?? "")} onChange={set("commission_percent")} inputMode="decimal" className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={String(v.landed_overhead_pct)} onChange={set("landed_overhead_pct")} inputMode="decimal" className={input} dir="ltr" />
      </td>
      <td className="px-1 py-2">
        <input value={v.default_currency} onChange={set("default_currency")} maxLength={3} className={cn(input, "uppercase")} dir="ltr" />
      </td>
      <td className="px-2 py-2 tabular-nums text-mutedtext">{offers ?? "—"}</td>
      <td className="px-2 py-2">
        <input type="checkbox" checked={v.active} onChange={set("active")} aria-label={t("active")} />
      </td>
      <td className="px-1 py-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className="inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t("save")}
        </button>
        {msg && <p className="mt-1 text-[11px] text-destructive">{msg}</p>}
      </td>
    </tr>
  );
}

function Settings({ locale, floorPct, fx }: { locale: string; floorPct: number; fx: Record<string, number> }) {
  const t = useTranslations("Sourcing");
  const router = useRouter();
  const [floor, setFloor] = useState(String(floorPct));
  const [rates, setRates] = useState(
    Object.entries(fx)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const save = () =>
    start(async () => {
      const parsed: Record<string, number> = {};
      for (const line of rates.split(/\n|,/)) {
        const [k, v] = line.split("=").map((x) => x.trim());
        if (k && v) parsed[k] = Number(v);
      }
      const r = await saveSourcingSettings(locale, Number(floor), parsed);
      setMsg(r.error ?? t("saved"));
      if (!r.error) router.refresh();
    });

  return (
    <div className="neu grid gap-6 p-6 sm:grid-cols-2">
      <label className="block text-sm text-body">
        <span className="font-semibold text-heading">{t("floorLabel")}</span>
        <span className="mt-1 block text-xs text-mutedtext">{t("floorHelp")}</span>
        <input value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="decimal" className={cn(input, "mt-2 w-32 text-sm")} dir="ltr" />
      </label>
      <label className="block text-sm text-body">
        <span className="font-semibold text-heading">{t("fxLabel")}</span>
        <span className="mt-1 block text-xs text-mutedtext">{t("fxHelp")}</span>
        <textarea value={rates} onChange={(e) => setRates(e.target.value)} rows={6} className={cn(input, "mt-2 font-mono text-sm")} dir="ltr" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("saveSettings")}
        </button>
        {msg && <span className="text-sm text-mutedtext">{msg}</span>}
      </div>
    </div>
  );
}

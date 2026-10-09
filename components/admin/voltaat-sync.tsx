"use client";

// Voltaat sync controls (Task 19g): on/off switch, "Run now", and mapping one
// of our products to one Voltaat product page.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Loader2, Play, Plus } from "lucide-react";

import { mapVoltaatProduct, setVoltaatSync } from "@/app/[locale]/dashboard/store/suppliers/voltaat/actions";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export function VoltaatControls({ locale, enabled }: { locale: string; enabled: boolean }) {
  const t = useTranslations("VoltaatSync");
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = () =>
    start(async () => {
      const r = await setVoltaatSync(locale, !on);
      if (!("error" in r)) setOn(!on);
      router.refresh();
    });

  const [importing, setImporting] = useState(false);
  const importAll = async () => {
    setImporting(true);
    setMsg(null);
    const res = await fetch("/api/admin/voltaat-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publish: true }),
    }).catch(() => null);
    const d = res ? ((await res.json().catch(() => null)) as { created?: number; skippedMapped?: number; skippedDuplicate?: number; failed?: number; error?: string } | null) : null;
    setImporting(false);
    setMsg(
      d && !d.error
        ? t("imported", { created: d.created ?? 0, mapped: d.skippedMapped ?? 0, dup: d.skippedDuplicate ?? 0, failed: d.failed ?? 0 })
        : t("importFailed", { error: d?.error ?? "network" })
    );
    router.refresh();
  };

  const runNow = async () => {
    setRunning(true);
    setMsg(null);
    const res = await fetch("/api/admin/voltaat-sync", { method: "POST" }).catch(() => null);
    const d = res?.ok ? ((await res.json()) as { status: string; checked: number; changed: number; missing: number; error?: string }) : null;
    setRunning(false);
    setMsg(d ? t(`run_${d.status}`, { checked: d.checked, changed: d.changed, missing: d.missing, error: d.error ?? "" }) : t("run_failed", { error: "network", checked: 0, changed: 0, missing: 0 }));
    router.refresh();
  };

  return (
    <div className="neu flex flex-wrap items-center gap-4 p-5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        disabled={pending}
        className={cn("relative h-7 w-12 rounded-full transition", on ? "bg-emerald-600" : "bg-borderstrong")}
      >
        <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "start-6" : "start-1")} />
      </button>
      <span className="text-sm font-semibold text-heading">{on ? t("on") : t("off")}</span>
      <button
        type="button"
        onClick={runNow}
        disabled={running || !on}
        className="inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt disabled:opacity-50"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {running ? t("running") : t("runNow")}
      </button>
      <button
        type="button"
        onClick={importAll}
        disabled={importing}
        className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {importing ? t("importing") : t("importCatalogue")}
      </button>
      <p className="w-full text-xs text-mutedtext">{t("rules")}</p>
      {msg && <p className="w-full text-sm text-heading">{msg}</p>}
    </div>
  );
}

export function VoltaatMapForm({ locale }: { locale: string }) {
  const t = useTranslations("VoltaatSync");
  const router = useRouter();
  const [sku, setSku] = useState("");
  const [url, setUrl] = useState("");
  const [variants, setVariants] = useState<{ id: number; title: string; price: number }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const map = (variantId?: number) =>
    start(async () => {
      setMsg(null);
      const r = await mapVoltaatProduct(locale, sku, url, variantId);
      if ("error" in r) {
        if (r.error === "choose_variant" && r.variants) setVariants(r.variants);
        else setMsg({ ok: false, text: t.has(`err_${r.error}`) ? t(`err_${r.error}`) : r.error });
        return;
      }
      setVariants(null);
      setMsg({ ok: true, text: t("mapped", { price: r.price.toFixed(2) }) });
      setSku("");
      setUrl("");
      router.refresh();
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        map();
      }}
      className="neu space-y-3 p-5"
    >
      <h2 className="text-base font-bold text-heading">{t("mapTitle")}</h2>
      <p className="text-xs text-mutedtext">{t("mapHelp")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("ourSku")}</span>
          <input value={sku} onChange={(e) => setSku(e.target.value)} required className={input} dir="ltr" />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("voltaatLink")}</span>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setVariants(null);
            }}
            required
            placeholder="https://www.voltaat.com/products/…"
            className={input}
            dir="ltr"
          />
        </label>
        <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("map")}
        </button>
      </div>
      {variants && (
        <div className="space-y-2 rounded-xl bg-panel p-3 text-sm">
          <p className="text-body">{t("chooseVariant")}</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button key={v.id} type="button" onClick={() => map(v.id)} className="rounded-full border border-borderstrong px-3 py-1 text-[12px] hover:border-cobalt">
                {v.title} · QAR {v.price.toFixed(2)}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-emerald-700" : "text-destructive")}>{msg.text}</p>}
    </form>
  );
}

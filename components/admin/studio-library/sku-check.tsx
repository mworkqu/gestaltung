"use client";

// "Check" for store SKUs (P5-15c): looks the typed SKUs up in the store and
// shows each product's photo + name, or that the SKU was not found. Used on the
// Studio library list (quick link) and on the part form.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";

import { lookupSkus, type SkuLookup } from "@/app/[locale]/dashboard/studio-library/actions";
import { partImageUrl } from "@/lib/parts/format";
import { parseCommaList } from "@/lib/studio/library/form";

export function SkuCheckButton({ value, onResult }: { value: string; onResult: (r: SkuLookup | "failed" | null) => void }) {
  const t = useTranslations("StudioLibrary");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || !value.trim()}
      onClick={() =>
        start(async () => {
          const r = await lookupSkus(parseCommaList(value));
          onResult(r ?? "failed");
        })
      }
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-cobalt hover:text-cobalt-hover disabled:opacity-50 md:min-h-9"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
      {t("skuCheck")}
    </button>
  );
}

export function SkuCheckResult({ result }: { result: SkuLookup | "failed" | null }) {
  const t = useTranslations("StudioLibrary");
  if (!result) return null;
  if (result === "failed") return <p className="text-sm text-destructive">{t("skuCheckFailed")}</p>;
  if (!result.found.length && !result.missing.length) return null;
  return (
    <ul className="mt-2 space-y-1.5" aria-live="polite">
      {result.found.map((p) => {
        const img = partImageUrl(p);
        return (
          <li key={p.sku} className="flex items-center gap-2 text-sm">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail, remote hosts vary
              <img src={img} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-md border border-white/60 bg-white object-contain" />
            ) : (
              <span className="h-8 w-8 shrink-0 rounded-md border border-white/60 bg-panel" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="font-mono text-xs text-mutedtext" dir="ltr">{p.sku}</span>{" "}
              <span className="text-heading">{p.name}</span>
              {!p.published && <span className="ms-2 text-xs font-semibold text-amber-700">{t("skuUnpublished")}</span>}
              {p.merged && <span className="ms-2 text-xs font-semibold text-amber-700">{t("skuMerged")}</span>}
            </span>
          </li>
        );
      })}
      {result.missing.map((sku) => (
        <li key={sku} className="text-sm text-destructive">
          <span className="font-mono text-xs" dir="ltr">{sku}</span> — {t("skuNotFound")}
        </li>
      ))}
    </ul>
  );
}

/** Input + Check + result, for the form. */
export function SkuField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<SkuLookup | "failed" | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          disabled={disabled}
          dir="ltr"
          placeholder="VLT-12345, DK-…"
          onChange={(e) => {
            onChange(e.target.value);
            setResult(null);
          }}
          className="w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
        />
        <SkuCheckButton value={value} onResult={setResult} />
      </div>
      <SkuCheckResult result={result} />
    </div>
  );
}

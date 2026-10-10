"use client";

// Studio library list (P5-15c): every part the Studio can pick, where it comes
// from (Code / Edited / New), an On switch for owner rows, and a quick "Store
// SKUs" field per part (the owner's most urgent job: every part says "We'll
// source this" until a SKU is linked). Read-only before migration 0070.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { resetPart, savePartSkus, setPartEnabled, type SaveResult, type SkuLookup } from "@/app/[locale]/dashboard/studio-library/actions";
import type { PartSource } from "@/lib/studio/library/merge";
import { SkuCheckButton, SkuCheckResult } from "./sku-check";

export type LibraryRow = {
  id: string;
  name: string;
  category: string;
  source: PartSource;
  /** null = no studio_parts row (code part as shipped). */
  enabled: boolean | null;
  skus: string;
  problems: string[];
};

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60 disabled:opacity-60";

function useMessage() {
  const t = useTranslations("StudioLibrary");
  return (r: SaveResult) =>
    r.ok ? t("saved") : r.message === "run_0070" ? t("needsMigration") : r.message === "forbidden" ? t("forbidden") : r.checks?.length ? r.checks.join(" · ") : t("failed");
}

function Row({ row, locale, readOnly }: { row: LibraryRow; locale: string; readOnly: boolean }) {
  const t = useTranslations("StudioLibrary");
  const router = useRouter();
  const say = useMessage();
  const [skus, setSkus] = useState(row.skus);
  const [check, setCheck] = useState<SkuLookup | "failed" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = skus.trim() !== row.skus.trim();

  const run = (fn: () => Promise<SaveResult>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: say(r) });
      if (r.ok) router.refresh();
    });

  const badge =
    row.source === "code" ? "bg-panel text-mutedtext" : row.source === "edited" ? "bg-cobalt/10 text-cobalt" : "bg-emerald-100 text-emerald-800";

  return (
    <li className="tile min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-heading">{row.name}</p>
          <p className="text-xs text-mutedtext">
            <span className="font-mono" dir="ltr">{row.id}</span> · {t(`cat_${row.category}`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}>{t(`source_${row.source}`)}</span>
          {row.enabled !== null && (
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-body md:min-h-0">
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={readOnly || pending}
                onChange={(e) => run(() => setPartEnabled(locale, row.id, e.target.checked))}
                className="h-4 w-4 accent-cobalt"
              />
              {t("enabled")}
            </label>
          )}
          <Link href={`/dashboard/studio-library/${row.id}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-cobalt hover:text-cobalt-hover md:min-h-0">
            {readOnly ? t("view") : t("edit")}
          </Link>
          {row.enabled !== null && !readOnly && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(row.source === "new" ? t("confirmDelete") : t("confirmReset"))) run(() => resetPart(locale, row.id));
              }}
              className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-mutedtext hover:text-destructive md:min-h-0"
            >
              {row.source === "new" ? t("delete") : t("reset")}
            </button>
          )}
        </div>
      </div>

      {row.problems.length > 0 && (
        <p className="text-sm text-destructive" role="alert">
          {t("rowProblems")} {row.problems.join(" · ")}
        </p>
      )}

      <div>
        <label htmlFor={`skus-${row.id}`} className="block text-xs font-medium text-body">
          {t("fieldSkus")}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            id={`skus-${row.id}`}
            value={skus}
            disabled={readOnly}
            dir="ltr"
            placeholder={t("skuPlaceholder")}
            onChange={(e) => {
              setSkus(e.target.value);
              setCheck(null);
              setMsg(null);
            }}
            className={input}
          />
          <SkuCheckButton value={skus} onResult={setCheck} />
          {!readOnly && (
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={() => run(() => savePartSkus(locale, row.id, skus))}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cobalt px-4 text-sm font-semibold text-white disabled:opacity-40 md:min-h-9"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {t("save")}
            </button>
          )}
        </div>
        {!row.skus.trim() && !skus.trim() && <p className="mt-1 text-xs text-mutedtext">{t("noSkus")}</p>}
        <SkuCheckResult result={check} />
        {msg && (
          <p className={`mt-1 text-sm ${msg.ok ? "text-emerald-700" : "text-destructive"}`} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
      </div>
    </li>
  );
}

export function StudioLibraryList({ locale, rows, readOnly }: { locale: string; rows: LibraryRow[]; readOnly: boolean }) {
  const t = useTranslations("StudioLibrary");
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyMissing || !r.skus.trim()) &&
        (!k || r.name.toLowerCase().includes(k) || r.id.includes(k) || r.category.includes(k) || r.skus.toLowerCase().includes(k)),
    );
  }, [rows, q, onlyMissing]);
  const missing = rows.filter((r) => !r.skus.trim()).length;

  return (
    <div className="neu space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-body">{t("count", { total: String(rows.length), missing: String(missing) })}</p>
        {!readOnly && (
          <Link
            href="/dashboard/studio-library/new"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt-hover"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("addPart")}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className={`${input} max-w-xs`}
        />
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="h-4 w-4 accent-cobalt" />
          {t("onlyMissing")}
        </label>
      </div>
      <ul className="space-y-3">
        {shown.map((r) => (
          <Row key={r.id} row={r} locale={locale} readOnly={readOnly} />
        ))}
      </ul>
    </div>
  );
}

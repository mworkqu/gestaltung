"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Download, Loader2, AlertTriangle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  importPartsFromSheet,
  type ImportResult,
} from "@/app/[locale]/dashboard/store/actions";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function SheetImportForm({
  locale,
  defaultUrl,
}: {
  locale: "en" | "ar";
  defaultUrl: string;
}) {
  const t = useTranslations("PartsDashboard");
  const [url, setUrl] = useState(defaultUrl);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importPartsFromSheet(locale, url.trim());
      setResult(res);
    } catch {
      setResult({ error: "fetch_failed" });
    } finally {
      setLoading(false);
    }
  }

  const errorText = (r: ImportResult) => {
    switch (r.error) {
      case "missing_columns":
        return t("import_err_missing", { cols: (r.missing ?? []).join(", ") });
      case "auth":
        return t("import_err_auth");
      case "bad_url":
        return t("import_err_bad_url");
      case "bad_host":
        return t("import_err_bad_host");
      case "fetch_failed":
        return t("import_err_fetch");
      case "no_header":
        return t("import_err_no_header");
      case "no_rows":
        return t("import_err_no_rows");
      case "empty":
        return t("import_err_empty");
      case "db":
      default:
        return t("import_err_db");
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="csv_url" className="block text-sm font-medium text-heading">
          {t("import_url_label")}
        </label>
        <input
          id="csv_url"
          name="csv_url"
          type="url"
          dir="ltr"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("import_url_placeholder")}
          className={fieldClass}
        />
      </div>

      <Button type="submit" size="lg" disabled={loading} className="rounded-full">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {loading ? t("import_importing") : t("import_button")}
      </Button>

      {result && result.ok && (
        <div className="neu-inset space-y-3 p-5">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
            <p className="text-sm font-semibold text-heading">
              {t("import_result_ok", { count: result.imported ?? 0 })}
            </p>
          </div>
          {result.skipped && result.skipped.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm text-mutedtext">
                {t("import_result_skipped", { count: result.skipped.length })}
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-faint">
                {result.skipped.map((s, i) => (
                  <li key={`${s.row}-${i}`}>
                    {t("import_skip_row", { row: s.row })}
                    {s.sku ? ` (${s.sku})` : ""} — {t(`import_skip_${s.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/dashboard/store">{t("import_back")}</Link>
            </Button>
            <Button asChild size="sm" className="rounded-full">
              <Link href="/store">{t("import_view_store")}</Link>
            </Button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorText(result)}</span>
        </div>
      )}
    </form>
  );
}

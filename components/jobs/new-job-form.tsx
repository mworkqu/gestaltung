"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, UploadCloud, FileBox, X } from "lucide-react";

import { useRouter, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { createJob } from "@/app/[locale]/dashboard/jobs/actions";
import {
  CAD_BUCKET,
  JOB_METHODS,
  EXT_ALIASES,
  ACCEPT_ATTR,
  ACCEPT_EXTENSIONS,
  MAX_FILE_BYTES,
  PRODUCTION_QTY_RANGES,
  POST_PROCESSING_OPTIONS,
} from "@/lib/jobs/constants";
import type { JobPath, SpeedTier } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function NewJobForm({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Stage 8b upsells.
  const [jobPath, setJobPath] = useState<JobPath>("prototype");
  const [qtyRange, setQtyRange] = useState("");
  const [speedTier, setSpeedTier] = useState<SpeedTier>("standard");
  const [postProcessing, setPostProcessing] = useState<string[]>([]);
  const [inspectionReport, setInspectionReport] = useState(false);

  function togglePostProcessing(option: string) {
    setPostProcessing((prev) =>
      prev.includes(option)
        ? prev.filter((p) => p !== option)
        : [...prev, option]
    );
  }

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
    </label>
  );
  const groupLabel = (text: string) => (
    <span className={mono("block text-[10px] text-mutedtext")}>{text}</span>
  );

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...picked.filter((f) => !seen.has(f.name + f.size))];
    });
    e.target.value = ""; // allow re-picking the same file
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    // Production path needs an estimated quantity range before anything uploads.
    if (jobPath === "production" && !qtyRange) {
      setError(t("error_qty_range"));
      return;
    }

    // Validate files client-side before uploading.
    if (files.length === 0) {
      setError(t("error_no_files"));
      return;
    }
    for (const f of files) {
      if (!ACCEPT_EXTENSIONS.includes(extOf(f.name))) {
        setError(t("error_file_type"));
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(t("error_too_large"));
        return;
      }
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const groupId = crypto.randomUUID();
      const uploaded: {
        storage_path: string;
        file_name: string;
        file_ext: string;
        size_bytes: number;
      }[] = [];

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const path = `${tenantId}/${groupId}/${i}-${sanitize(f.name)}`;
        const { error: upErr } = await supabase.storage
          .from(CAD_BUCKET)
          .upload(path, f, { upsert: false });
        if (upErr) {
          setError(t("error_upload"));
          setLoading(false);
          return;
        }
        uploaded.push({
          storage_path: path,
          file_name: f.name,
          file_ext: EXT_ALIASES[extOf(f.name)],
          size_bytes: f.size,
        });
      }

      const res = await createJob({
        locale,
        title: String(data.get("title") ?? ""),
        material: String(data.get("material") ?? ""),
        quantity: Number(data.get("quantity") ?? 1),
        notes: String(data.get("notes") ?? ""),
        method: String(data.get("method") ?? ""),
        job_path: jobPath,
        production_qty_range: jobPath === "production" ? qtyRange : null,
        speed_tier: speedTier,
        post_processing: postProcessing,
        inspection_report: inspectionReport,
        files: uploaded,
      });

      if (res.error) {
        setError(t(res.error as Parameters<typeof t>[0]));
        setLoading(false);
        return;
      }
      router.push(`/dashboard/jobs/${res.jobId}`);
      router.refresh();
    } catch {
      setError(t("error_unknown"));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        {label("title", t("titleLabel"))}
        <input
          id="title"
          name="title"
          required
          placeholder={t("titlePlaceholder")}
          className={fieldClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          {label("method", t("methodLabel"))}
          <select
            id="method"
            name="method"
            required
            defaultValue=""
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="" disabled>
              {t("methodPlaceholder")}
            </option>
            {JOB_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method_${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          {label("material", t("materialLabel"))}
          <input
            id="material"
            name="material"
            placeholder={t("materialPlaceholder")}
            className={fieldClass}
          />
        </div>
      </div>

      <div className="space-y-2 sm:max-w-[12rem]">
        {label("quantity", t("quantityLabel"))}
        <input
          id="quantity"
          name="quantity"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={1}
          className={fieldClass}
        />
      </div>

      {/* File upload */}
      <div className="space-y-2">
        {label("files", t("filesLabel"))}
        <label
          htmlFor="files"
          className="neu-inset flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-4 py-8 text-center transition hover:text-cobalt"
        >
          <UploadCloud className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          <span className="text-sm font-medium text-heading">
            {t("filesCta")}
          </span>
          <span className="text-[11px] text-faint">{t("filesHint")}</span>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={onPickFiles}
            className="sr-only"
          />
        </label>

        {files.length > 0 && (
          <ul className="space-y-2 pt-1">
            {files.map((f, i) => (
              <li
                key={f.name + f.size + i}
                className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2 shadow-neu-sm"
              >
                <FileBox className="h-4 w-4 shrink-0 text-cobalt" />
                <span className="flex-1 truncate text-sm text-body" dir="ltr">
                  {f.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-faint">
                  {(f.size / 1024 / 1024).toFixed(2)} MB
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={t("removeFile")}
                  className="shrink-0 text-mutedtext hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Path: prototyping vs low-volume production */}
      <div className="space-y-2">
        {groupLabel(t("pathLabel"))}
        <div className="grid gap-3 sm:grid-cols-2">
          {(["prototype", "production"] as const).map((path) => (
            <label
              key={path}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 transition",
                jobPath === path
                  ? "border-cobalt bg-cobalt/5 shadow-neu-sm"
                  : "border-white/60 bg-panel shadow-neu-inset hover:border-cobalt/40"
              )}
            >
              <input
                type="radio"
                name="job_path"
                value={path}
                checked={jobPath === path}
                onChange={() => setJobPath(path)}
                className="sr-only"
              />
              <span className="text-sm font-bold text-heading">
                {t(`path_${path}`)}
              </span>
              <span className="text-[11px] leading-snug text-mutedtext">
                {t(`path_${path}_sub`)}
              </span>
            </label>
          ))}
        </div>

        {jobPath === "production" && (
          <div className="space-y-2 pt-2">
            {label("production_qty_range", t("qtyRangeLabel"))}
            <select
              id="production_qty_range"
              name="production_qty_range"
              value={qtyRange}
              onChange={(e) => setQtyRange(e.target.value)}
              className={cn(fieldClass, isRtl && "text-right", "sm:max-w-[16rem]")}
            >
              <option value="" disabled>
                {t("qtyRangePlaceholder")}
              </option>
              {PRODUCTION_QTY_RANGES.map((r) => (
                <option key={r} value={r}>
                  {t(`qty_range_${r.replace(/[-+]/g, "_")}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Speed tier */}
      <div className="space-y-2">
        {groupLabel(t("speedLabel"))}
        <div className="grid gap-3 sm:grid-cols-2">
          {(["standard", "express"] as const).map((tier) => (
            <label
              key={tier}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 transition",
                speedTier === tier
                  ? "border-cobalt bg-cobalt/5 shadow-neu-sm"
                  : "border-white/60 bg-panel shadow-neu-inset hover:border-cobalt/40"
              )}
            >
              <input
                type="radio"
                name="speed_tier"
                value={tier}
                checked={speedTier === tier}
                onChange={() => setSpeedTier(tier)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-bold text-heading">
                {t(`speed_${tier}`)}
                {tier === "express" && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                    {t("rushBadge")}
                  </span>
                )}
              </span>
              <span className="text-[11px] leading-snug text-mutedtext">
                {t(`speed_${tier}_sub`)}
              </span>
            </label>
          ))}
        </div>
        {speedTier === "express" && (
          <p className="text-[11px] leading-snug text-faint">{t("speedNote")}</p>
        )}
      </div>

      {/* Add-ons */}
      <div className="space-y-2">
        {groupLabel(t("addonsLabel"))}
        <div className="space-y-2">
          {POST_PROCESSING_OPTIONS.map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition",
                postProcessing.includes(option)
                  ? "border-cobalt bg-cobalt/5 shadow-neu-sm"
                  : "border-white/60 bg-panel shadow-neu-inset hover:border-cobalt/40"
              )}
            >
              <input
                type="checkbox"
                checked={postProcessing.includes(option)}
                onChange={() => togglePostProcessing(option)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-cobalt"
              />
              <span>
                <span className="block text-sm font-bold text-heading">
                  {t(`addon_${option}`)}
                </span>
                <span className="block text-[11px] leading-snug text-mutedtext">
                  {t(`addon_${option}_sub`)}
                </span>
              </span>
            </label>
          ))}
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition",
              inspectionReport
                ? "border-cobalt bg-cobalt/5 shadow-neu-sm"
                : "border-white/60 bg-panel shadow-neu-inset hover:border-cobalt/40"
            )}
          >
            <input
              type="checkbox"
              checked={inspectionReport}
              onChange={() => setInspectionReport((v) => !v)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-cobalt"
            />
            <span>
              <span className="block text-sm font-bold text-heading">
                {t("addon_inspection")}
              </span>
              <span className="block text-[11px] leading-snug text-mutedtext">
                {t("addon_inspection_sub")}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="space-y-2">
        {label("notes", t("notesLabel"))}
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder={t("notesPlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading} className="rounded-full">
          {loading && <Loader2 className="animate-spin" />}
          {loading ? t("uploading") : t("createSubmit")}
        </Button>
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/dashboard/jobs">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}

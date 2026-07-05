"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";

import { useRouter, Link } from "@/i18n/navigation";
import { updateInternalJob } from "@/app/[locale]/design/jobs/actions";
import { JOB_METHODS } from "@/lib/jobs/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/supabase/types";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

type PartRow = { name: string; quantity: string; unit: string };

export function EditInternalJobForm({ job }: { job: Job }) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [parts, setParts] = useState<PartRow[]>(
    (job.parts ?? []).length
      ? (job.parts ?? []).map((p) => ({
          name: p.name,
          quantity: String(p.quantity),
          unit: p.unit,
        }))
      : [{ name: "", quantity: "1", unit: "pcs" }]
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
    </label>
  );

  function setPart(i: number, key: keyof PartRow, value: string) {
    setParts((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p))
    );
  }
  function addPart() {
    setParts((prev) => [...prev, { name: "", quantity: "1", unit: "pcs" }]);
  }
  function removePart(i: number) {
    setParts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const data = new FormData(e.currentTarget);

    const res = await updateInternalJob({
      locale,
      jobId: job.id,
      title: String(data.get("title") ?? ""),
      notes: String(data.get("notes") ?? ""),
      method: String(data.get("method") ?? ""),
      parts: parts.map((p) => ({
        name: p.name,
        quantity: Number(p.quantity),
        unit: p.unit,
      })),
    });

    if (res.error) {
      setError(t(res.error as Parameters<typeof t>[0]));
      setLoading(false);
      return;
    }
    router.push(`/design/jobs/${job.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        {label("title", t("titleLabel"))}
        <input
          id="title"
          name="title"
          required
          defaultValue={job.title}
          placeholder={t("internalTitlePlaceholder")}
          className={fieldClass}
        />
      </div>

      <div className="space-y-2 sm:max-w-sm">
        {label("method", t("methodLabel"))}
        <select
          id="method"
          name="method"
          required
          defaultValue={job.method}
          className={cn(fieldClass, isRtl && "text-right")}
        >
          {JOB_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`method_${m}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Parts list */}
      <div className="space-y-2">
        <span className={mono("block text-[10px] text-mutedtext")}>
          {t("partsLabel")}
        </span>
        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={t("partName")}
                value={p.name}
                onChange={(e) => setPart(i, "name", e.target.value)}
                placeholder={t("partName")}
                className={cn(fieldClass, "flex-1")}
              />
              <input
                aria-label={t("partQty")}
                type="number"
                min={0}
                step="0.01"
                value={p.quantity}
                onChange={(e) => setPart(i, "quantity", e.target.value)}
                className={cn(fieldClass, "w-24")}
              />
              <input
                aria-label={t("partUnit")}
                value={p.unit}
                onChange={(e) => setPart(i, "unit", e.target.value)}
                placeholder={t("partUnit")}
                className={cn(fieldClass, "w-24")}
              />
              <button
                type="button"
                onClick={() => removePart(i)}
                aria-label={t("removeFile")}
                className="shrink-0 text-mutedtext hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addPart}
          className="rounded-full"
        >
          <Plus className="h-4 w-4" />
          {t("addPart")}
        </Button>
      </div>

      <div className="space-y-2">
        {label("notes", t("notesLabel"))}
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={job.notes ?? ""}
          placeholder={t("notesPlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading} className="rounded-full">
          {loading && <Loader2 className="animate-spin" />}
          {t("editSubmit")}
        </Button>
        <Button asChild variant="ghost" className="rounded-full">
          <Link href={`/design/jobs/${job.id}`}>{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter, Link } from "@/i18n/navigation";
import { updateJob } from "@/app/[locale]/dashboard/jobs/actions";
import { JOB_METHODS } from "@/lib/jobs/constants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/supabase/types";

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function EditJobForm({ job }: { job: Job }) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className={mono("block text-[10px] text-mutedtext")}>
      {text}
    </label>
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const res = await updateJob({
      locale,
      jobId: job.id,
      title: String(data.get("title") ?? ""),
      material: String(data.get("material") ?? ""),
      quantity: Number(data.get("quantity") ?? 1),
      notes: String(data.get("notes") ?? ""),
      method: String(data.get("method") ?? ""),
    });

    if (res.error) {
      setError(t(res.error as Parameters<typeof t>[0]));
      setLoading(false);
      return;
    }

    router.push(`/dashboard/jobs/${job.id}`);
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
        <div className="space-y-2">
          {label("material", t("materialLabel"))}
          <input
            id="material"
            name="material"
            defaultValue={job.material ?? ""}
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
          defaultValue={job.quantity}
          className={fieldClass}
        />
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
          <Link href={`/dashboard/jobs/${job.id}`}>{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}

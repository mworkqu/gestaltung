"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";

import { togglePublished } from "@/app/[locale]/dashboard/store/actions";
import { cn } from "@/lib/utils";

// Inline publish/unpublish pill in the catalog table. Posts the next state to
// the server action (RLS enforces super_admin) and shows its error, e.g. when
// a merged duplicate cannot be published.
export function PublishedToggle({
  id,
  published,
}: {
  id: string;
  published: boolean;
}) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    formData.set("is_published", String(!published));
    setError(null);
    startTransition(async () => {
      try {
        const result = await togglePublished(formData);
        if (result?.error) setError(result.error);
      } catch {
        setError(t("error_unknown"));
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={published}
        className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-50",
          published
            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading"
        )}
      >
        {published ? t("published") : t("draft")}
      </button>
      {error && (
        <p role="alert" className="max-w-[16rem] text-[11px] leading-snug text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

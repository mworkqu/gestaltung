"use client";

// Download project JSON / Copy as JSON for one project row. Both read the same
// super_admin-only endpoint; nothing is cached in the page.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Download, Loader2 } from "lucide-react";

export function ProjectExportButtons({ projectId }: { projectId: string }) {
  const t = useTranslations("AdminProjects");
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const url = `/api/admin/projects/${projectId}/export`;

  async function copy() {
    setState("copying");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }

  const btn =
    "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition-colors hover:bg-panel";
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <a href={`${url}?download=1`} className={`${btn} text-cobalt`}>
        <Download className="h-3.5 w-3.5" />
        {t("download")}
      </a>
      <button type="button" onClick={copy} disabled={state === "copying"} className={`${btn} text-heading`}>
        {state === "copying" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "copied" ? (
          <Check className="h-3.5 w-3.5 text-buy" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {state === "copied" ? t("copied") : state === "failed" ? t("copyFailed") : t("copy")}
      </button>
    </span>
  );
}

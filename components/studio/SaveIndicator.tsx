"use client";

// D4: the small "Saved ✓ / Saving… / Not saved — retry" line in the Studio header, so it is
// always clear the work is safe. The paragraph is always mounted so screen readers (polite)
// announce each change.

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SaveStatus } from "@/lib/studio/client/save-state";
import { cn } from "@/lib/utils";

export function SaveIndicator({
  status,
  guest,
  onRetry,
}: {
  status: SaveStatus;
  guest: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("Studio");
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="studio-save-status"
      data-status={status}
      className={cn(
        "flex items-center gap-1.5 text-xs font-semibold",
        status === "saved" ? "text-mutedtext" : status === "saving" ? "text-body" : "text-destructive",
      )}
    >
      {status === "saved" && (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} aria-hidden />
          {guest ? t("saveSavedDevice") : t("saveSaved")}
        </>
      )}
      {status === "saving" && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {t("saveSaving")}
        </>
      )}
      {status === "failed" && (
        <>
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          {t("saveFailed")}
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center px-1 font-semibold text-cobalt underline underline-offset-2 hover:text-cobalt-hover sm:min-h-8"
          >
            {t("saveRetry")}
          </button>
        </>
      )}
    </p>
  );
}

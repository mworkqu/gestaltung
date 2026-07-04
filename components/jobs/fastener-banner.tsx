"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bolt, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// UI-only parts-store teaser on the job detail page (Stage 8b). Dismissal is
// remembered per job in localStorage; no backend until Stage 9.
const storageKey = (jobId: string) => `gestaltung:fastener-banner:${jobId}`;

export function FastenerBanner({ jobId }: { jobId: string }) {
  const t = useTranslations("PartsStore");
  // Start hidden and only show after the localStorage check, so a dismissed
  // banner never flashes (and SSR/client markup stay in sync).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(storageKey(jobId))) setVisible(true);
    } catch {
      setVisible(true); // storage unavailable → just show it
    }
  }, [jobId]);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(storageKey(jobId), "1");
    } catch {
      // storage unavailable — hiding for this view is enough
    }
  }

  if (!visible) return null;

  return (
    <div className="neu relative mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
        <Bolt className="h-5 w-5 text-white" strokeWidth={1.5} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-bold text-heading">{t("bannerTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-mutedtext">
          {t("bannerBody")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" className="rounded-full">
          <Link href="/store">{t("bannerCta")}</Link>
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("bannerDismiss")}
          className="flex h-8 w-8 items-center justify-center rounded-full text-mutedtext transition hover:text-heading"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

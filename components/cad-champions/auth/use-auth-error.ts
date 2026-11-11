"use client";

import { useTranslations } from "next-intl";

/** Friendly text for a CC.auth.errors code (rateLimited gets the wait time, Western digits). */
export function useAuthErrorText() {
  const t = useTranslations("CC.auth.errors");
  return (code: string | null | undefined, retryAfterSec?: number): string => {
    if (!code) return "";
    if (code === "rateLimited") {
      return retryAfterSec ? t("rateLimited", { seconds: String(retryAfterSec) }) : t("rateLimitedNoTime");
    }
    return t.has(code) ? t(code) : t("unknown");
  };
}

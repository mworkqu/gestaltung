"use client";

import * as React from "react";
import { Copy, Share2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { setResultShare } from "@/app/[locale]/cad-champions/results/[attemptId]/actions";
import { Button, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

/** Off by default. On = a public link that shows only first name, band and skill map. */
export function ShareToggle({ attemptId, initialEnabled, initialToken, ready }: { attemptId: string; initialEnabled: boolean; initialToken: string | null; ready: boolean }) {
  const t = useTranslations("CC.results.share");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const [enabled, setEnabled] = React.useState(initialEnabled && !!initialToken);
  const [token, setToken] = React.useState(initialToken);
  const [pending, startTransition] = React.useTransition();
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = token ? `${origin}${ccPath(locale, `/results/share/${token}`)}` : "";

  function toggle() {
    const next = !enabled;
    startTransition(async () => {
      const res = await setResultShare({ attemptId, enabled: next });
      if (!res.ok) {
        toast.error(res.error === "not_ready" ? t("notReady") : t("error"));
        return;
      }
      setEnabled(res.enabled);
      setToken(res.token);
      toast.success(res.enabled ? t("savedOn") : t("savedOff"));
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("error"));
    }
  }

  return (
    <section className="neu space-y-3 p-6" aria-labelledby="cc-share-title">
      <div className="flex items-center gap-2">
        <Share2 aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-accent" />
        <h2 id="cc-share-title" className="text-lg font-extrabold text-heading">
          {t("title")}
        </h2>
      </div>
      <p className="text-sm text-body">{t("text")}</p>
      {!ready ? (
        <p className="text-sm text-mutedtext">{t("notReady")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t("toggle")}
            onClick={toggle}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-3 rounded-full px-1 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-cobalt" : "bg-panel shadow-neu-inset"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "start-[1.375rem]" : "start-0.5"}`}
              />
            </span>
            {t("toggle")}: {enabled ? t("on") : t("off")}
          </button>
          {enabled && token ? (
            <>
              <span className="min-w-0 max-w-full truncate rounded-lg bg-panel px-3 py-2 text-xs text-body">
                <Ltr>{url}</Ltr>
              </span>
              <Button variant="secondary" size="sm" onClick={copy}>
                <Copy aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                {t("copy")}
              </Button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

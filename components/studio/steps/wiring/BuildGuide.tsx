"use client";

// "Wire it step by step" (P5-17): walks the connections in build order (ground,
// power, then each signal). It only sets the guide index; the Wiring drawing and
// the 3D view animate the current wire themselves.

import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Footprints, X } from "lucide-react";

import { connectionKey } from "@/lib/studio/connections";
import { guideLine } from "@/lib/studio/pin-list";
import type { Locale } from "@/lib/studio/netlist";
import { cn } from "@/lib/utils";
import { linkCls } from "../../ui";
import { WireSwatch } from "./SelectedWire";
import { useWiringViews } from "./views-context";

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-neu-sm disabled:opacity-50";

export function BuildGuide({ locale }: { locale: Locale }) {
  const t = useTranslations("Studio.views.guide");
  const { connections, guide, setGuide, ticked, toggleTick, select, getPart } = useWiringViews();
  const n = connections.length;
  if (n === 0) return null;

  if (guide === null) {
    return (
      <div className="flex" data-no-print>
        <button
          type="button"
          className={cn(btn, "text-cobalt")}
          onClick={() => {
            setGuide(0);
            select(connections[0].id);
          }}
          data-testid="studio-guide-start"
        >
          <Footprints className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("start")}
        </button>
      </div>
    );
  }

  const i = Math.min(Math.max(guide, 0), n - 1);
  const c = connections[i];
  const last = i === n - 1;
  const isTicked = ticked.has(connectionKey(c));
  const go = (j: number) => {
    setGuide(j);
    select(connections[j].id);
  };

  return (
    <div
      role="group"
      aria-label={t("region")}
      tabIndex={-1}
      data-testid="studio-guide"
      data-step={i + 1}
      className="tile flex flex-col gap-3 border-0 p-3 outline-none sm:p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setGuide(null);
          return;
        }
        const rtl = document.documentElement.dir === "rtl";
        const fwd = rtl ? "ArrowLeft" : "ArrowRight";
        const back = rtl ? "ArrowRight" : "ArrowLeft";
        if (e.key === fwd && !last) go(i + 1);
        else if (e.key === back && i > 0) go(i - 1);
      }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1">
          <WireSwatch c={c} size={22} />
        </span>
        <p
          className="min-w-0 flex-1 pt-0.5 text-sm font-semibold text-heading sm:text-base"
          aria-live="polite"
          dir="auto"
          data-testid="studio-guide-line"
        >
          {guideLine(c, i, n, getPart, locale)}
        </p>
        <button type="button" className={linkCls} onClick={() => setGuide(null)} data-testid="studio-guide-close">
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("close")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(btn, "text-heading")} disabled={i === 0} onClick={() => go(i - 1)} data-testid="studio-guide-back">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden />
          {t("back")}
        </button>
        <button
          type="button"
          className={cn(btn, isTicked ? "text-mutedtext" : "text-heading")}
          onClick={() => {
            if (!isTicked) toggleTick(c);
            if (!last) go(i + 1);
          }}
          data-testid="studio-guide-mark"
          disabled={isTicked && last}
        >
          <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {isTicked ? t("marked") : t("markDone")}
        </button>
        {last ? (
          <button type="button" className={cn(btn, "bg-cobalt text-white")} onClick={() => setGuide(null)} data-testid="studio-guide-done">
            {t("done")}
          </button>
        ) : (
          <button type="button" className={cn(btn, "bg-cobalt text-white")} onClick={() => go(i + 1)} data-testid="studio-guide-next">
            {t("next")}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

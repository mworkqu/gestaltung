"use client";

// Pin list tab (P5-17): one row per wire in build order, with a tick box people
// use while wiring (saved on the project), Copy and Print. Rows are linked to
// the other views through the shared selection.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Code2, Copy, Printer } from "lucide-react";

import { pinListRows, pinListText } from "@/lib/studio/pin-list";
import type { Locale } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import { linkCls } from "../../ui";
import { WireSwatch } from "./SelectedWire";
import { useWiringViews } from "./views-context";

const PRINT_CSS = `@media print{
html.print-pinlist body *{visibility:hidden!important}
html.print-pinlist [data-print-pinlist],html.print-pinlist [data-print-pinlist] *{visibility:visible!important}
html.print-pinlist [data-print-pinlist]{position:absolute!important;left:0;top:0;width:100%;box-shadow:none!important}
html.print-pinlist [data-no-print]{display:none!important}
}`;

const COLS = "sm:grid-cols-[2.75rem_1.4fr_1.2fr_0.7fr_1fr_1.6fr]";
const COLS_ENG = "sm:grid-cols-[2.75rem_1.4fr_1.2fr_0.7fr_1fr_1.6fr_0.9fr]";

export function PinListView({ doc, locale }: { doc: StudioDoc; locale: Locale }) {
  void doc;
  const t = useTranslations("Studio.views.pins");
  const tv = useTranslations("Studio.views");
  const { connections, selectedId, select, setHover, ticked, toggleTick, engineer, showInCode, getPart } = useWiringViews();
  const rows = useMemo(() => pinListRows(connections, getPart, locale), [connections, getPart, locale]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  useEffect(() => {
    const off = () => document.documentElement.classList.remove("print-pinlist");
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("afterprint", off);
      off();
    };
  }, []);

  const done = rows.filter((r) => ticked.has(r.key)).length;
  const cols = engineer ? COLS_ENG : COLS;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pinListText(rows, locale, ticked));
      setCopied(true);
    } catch {
      /* clipboard blocked: nothing to show */
    }
  };
  const print = () => {
    document.documentElement.classList.add("print-pinlist");
    window.print();
  };

  if (rows.length === 0) {
    return <p className="tile border-0 p-4 text-sm text-mutedtext" data-testid="studio-pin-list">{t("empty")}</p>;
  }

  return (
    <div className="tile border-0 p-3 sm:p-4" data-testid="studio-pin-list" data-print-pinlist>
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex-1 text-sm font-semibold text-heading" aria-live="polite" data-testid="studio-pin-progress">
          {t("progress", { done: String(done), total: String(rows.length) })}
        </p>
        <div className="flex gap-2" data-no-print>
          <button type="button" className={cn(linkCls, "shadow-neu-sm")} onClick={copy} data-testid="studio-pin-copy">
            {copied ? <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            <span aria-live="polite">{copied ? t("copied") : t("copy")}</span>
          </button>
          <button type="button" className={cn(linkCls, "shadow-neu-sm")} onClick={print} data-testid="studio-pin-print">
            <Printer className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("print")}
          </button>
        </div>
      </div>

      <div
        className={cn("hidden items-center gap-x-3 px-2 pb-2 text-xs font-semibold text-mutedtext sm:grid", cols)}
        aria-hidden
      >
        <span>{t("colDone")}</span>
        <span>{t("colBoardPin")}</span>
        <span>{t("colGoesTo")}</span>
        <span>{t("colPartPin")}</span>
        <span>{t("colColour")}</span>
        <span>{t("colNote")}</span>
        {engineer && <span>{t("colEngineer")}</span>}
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const c = connections.find((x) => x.id === r.id)!;
          const isDone = ticked.has(r.key);
          const sel = selectedId === r.id;
          return (
            <li
              key={r.id}
              tabIndex={0}
              data-testid="studio-pin-row"
              data-connection={r.id}
              data-board-pin={r.boardPinLabel}
              aria-current={sel ? "true" : undefined}
              onClick={() => select(r.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(r.id);
                }
              }}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => e.target === e.currentTarget && setHover(r.id)}
              onBlur={(e) => e.target === e.currentTarget && setHover(null)}
              className={cn(
                "grid cursor-pointer grid-cols-[2.75rem_1fr] items-center gap-x-3 gap-y-1 rounded-2xl px-2 py-2 text-sm text-body outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-cobalt sm:gap-y-0",
                sel ? "shadow-neu-inset ring-1 ring-cobalt/40" : "shadow-neu-sm",
                isDone && "opacity-70",
                cols,
              )}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={isDone}
                aria-label={t("tickLabel", { from: r.boardPin, to: `${r.toPart} ${r.partPin}` })}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTick(c);
                }}
                className="row-span-4 flex h-11 w-11 items-center justify-center rounded-xl shadow-neu-inset sm:row-span-1"
                data-testid="studio-pin-tick"
              >
                {isDone && <Check className="h-5 w-5 text-cobalt" strokeWidth={2.5} aria-hidden />}
              </button>
              <span className="font-semibold text-heading" dir="auto">
                <span className="me-1 text-xs font-normal text-mutedtext sm:hidden">{t("colBoardPin")}</span>
                {r.boardPin}
              </span>
              <span className="col-start-2 sm:col-start-auto" dir="auto">
                <span className="me-1 text-xs text-mutedtext sm:hidden">{t("colGoesTo")}</span>
                {r.toPart}
              </span>
              <span className="col-start-2 font-semibold text-heading sm:col-start-auto" dir="auto">
                <span className="me-1 text-xs font-normal text-mutedtext sm:hidden">{t("colPartPin")}</span>
                {r.partPin}
              </span>
              <span className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                <WireSwatch c={{ wireColour: r.colour }} size={20} />
                <span>{r.colourName}</span>
              </span>
              <span className="col-start-2 text-mutedtext sm:col-start-auto" dir="auto">
                {r.note}
                {showInCode && (
                  <button
                    type="button"
                    className={cn(linkCls, "ms-1 min-h-11 px-1 text-xs")}
                    data-no-print
                    onClick={(e) => {
                      e.stopPropagation();
                      showInCode(r.id);
                    }}
                  >
                    <Code2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    {tv("showInCode")}
                  </button>
                )}
              </span>
              {engineer && (
                <span className="col-start-2 font-mono text-xs text-mutedtext sm:col-start-auto">
                  {r.id} · {r.net}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

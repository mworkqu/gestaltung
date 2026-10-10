"use client";

// The progress line at the top of the Design Studio: one dot per step in the
// step's own accent, done steps tappable (go back), the current one marked
// aria-current="step", future ones disabled. Built from FLOW, so adding a
// step (Phase 2 "print") is one entry in lib/studio/client/steps.ts.

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { FLOW, type FlowStep } from "@/lib/studio/client/steps";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { cn } from "@/lib/utils";

export function ProgressLine({
  current,
  furthest,
  done,
  onGo,
}: {
  current: number;
  furthest: number;
  done: (step: FlowStep) => boolean;
  onGo: (index: number) => void;
}) {
  const t = useTranslations("Studio");
  const top = useStickyTop();
  return (
    <nav
      aria-label={t("progressLabel")}
      className="sticky z-30 -mx-2 bg-gradient-to-b from-[#eef2f7] from-70% to-[#eef2f7]/0 px-2 pb-2 pt-2"
      style={{ top }}
    >
      <ol className="neu flex items-start justify-between overflow-x-auto px-2 py-2 sm:gap-1 sm:px-5 sm:py-2.5">
        {FLOW.map((step, i) => {
          const accent = STEP_ACCENT[step];
          const isCurrent = i === current;
          const isDone = done(step) && !isCurrent;
          const reachable = i <= furthest;
          const lit = isCurrent || isDone || reachable;
          return (
            <li key={step} className="relative flex min-w-0 flex-1 justify-center">
              {i > 0 && <Segment side="start" lit={i <= furthest} colour={STEP_ACCENT[FLOW[i - 1]].base} />}
              {i < FLOW.length - 1 && <Segment side="end" lit={i < furthest} colour={accent.base} />}
              <button
                type="button"
                onClick={() => onGo(i)}
                disabled={!reachable || isCurrent}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "relative z-10 flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 text-[9px] font-semibold tracking-tight transition-colors min-[400px]:text-[10px] sm:text-[11px] sm:tracking-normal",
                  isCurrent ? "text-heading" : reachable ? "text-body hover:text-heading" : "cursor-default text-faint",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full border-2 transition-[transform,background-color] duration-300",
                    isCurrent && "motion-safe:scale-110",
                  )}
                  style={{
                    borderColor: lit ? accent.base : "#d3dbe6",
                    background: isDone ? accent.base : isCurrent ? accent.soft : "#eef2f7",
                    boxShadow: isCurrent ? `0 0 0 4px ${accent.soft}` : undefined,
                  }}
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: lit ? accent.base : "#c9d3df" }} />
                  )}
                </span>
                <span className="whitespace-nowrap">{t(`step_${step}`)}</span>
                {isDone && <span className="sr-only">{t("stepDoneSr")}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Half of the line between two dots: a grey track with an accent fill that grows in the
 * reading direction when the step is reached (the end half first, then the next dot's
 * start half). No transition with reduced motion.
 */
function Segment({ side, lit, colour }: { side: "start" | "end"; lit: boolean; colour: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-[1.375rem] h-0.5 w-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-[#d3dbe6]",
        side === "start" ? "start-0" : "end-0",
      )}
    >
      <span
        className="block h-full w-full origin-left transition-transform duration-300 ease-out motion-reduce:transition-none rtl:origin-right"
        style={{
          background: colour,
          opacity: 0.55,
          transform: `scaleX(${lit ? 1 : 0})`,
          transitionDelay: lit && side === "start" ? "250ms" : "0ms",
        }}
      />
    </span>
  );
}

/** Sit right under the site header (its height changes with the company strip). */
function useStickyTop(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setTop(Math.round(header.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => {
      ro.disconnect();
    };
  }, []);
  return top;
}

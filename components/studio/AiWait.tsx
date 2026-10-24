"use client";

// F-024: the AI waits (the idea chat, drawing a case, writing the code) take 25-100 s, so the
// visitor sees which part of the job is under way, not just "Thinking…". Same honest idea as the
// Parts step ("Picking your parts… n of 6", lib/studio/client/progress.ts): the stage is a
// time-based guide and never reaches the last label before the answer arrives, and there is one
// "usually 30–60 seconds" hint rather than a per-step timing we cannot back up.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { pickStep } from "@/lib/studio/client/progress";

export type WaitKind = "idea" | "enclosure" | "code";

/** Three labels per job (messages Studio.wait.<kind>_1..3). */
export const WAIT_LABELS = 3;
/** The middle of "usually 30–60 s": how long the guide spreads its labels over. */
const WAIT_EXPECTED_MS = 45_000;

/** 1..WAIT_LABELS while `active`; resets when it stops. */
export function useWaitStage(active: boolean): number {
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (!active) {
      setStep(1);
      return;
    }
    const t0 = Date.now();
    setStep(1);
    // One extra stage so the last label is reachable but the guide never claims "done".
    const id = setInterval(() => setStep(pickStep(Date.now() - t0, WAIT_EXPECTED_MS, WAIT_LABELS + 1)), 500);
    return () => clearInterval(id);
  }, [active]);
  return step;
}

export function AiWait({ kind, active, className }: { kind: WaitKind; active: boolean; className?: string }) {
  const t = useTranslations("Studio");
  const step = useWaitStage(active);
  if (!active) return null;
  return (
    <p className={className} role="status" data-testid={`studio-wait-${kind}`}>
      <span className="font-semibold text-heading">{t(`wait.${kind}_${Math.min(step, WAIT_LABELS)}`)}</span>
      <span className="block text-xs text-mutedtext">{t("wait.hint")}</span>
    </p>
  );
}

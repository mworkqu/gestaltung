"use client";

import { useEffect, useState } from "react";

import { pickStep } from "@/lib/studio/client/progress";

/** 1..5 while `active` (time-based, see lib/studio/client/progress.ts); resets when it stops. */
export function usePickProgress(active: boolean): number {
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (!active) {
      setStep(1);
      return;
    }
    const t0 = Date.now();
    setStep(1);
    const id = setInterval(() => setStep(pickStep(Date.now() - t0)), 300);
    return () => clearInterval(id);
  }, [active]);
  return step;
}

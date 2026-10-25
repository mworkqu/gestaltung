"use client";

// Which Studio step is open, split out of StudioShell (R8).
//
//  * "Done" per step is derived from the doc (lib/studio/client/steps.ts);
//    done steps are tappable in the progress line, future ones are not.
//  * ?step= deep-links to any reachable step; the URL follows the current step.
//
// The step state lives in its own hook (useStudioSteps) because the first load
// (useStudioSave) sets it, and moving between steps (useStudioNavigation) needs
// the save machinery: state first, then save, then navigation.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { StudioDoc } from "@/lib/studio/schema";
import type { LoadResult } from "@/lib/studio/client/api";
import { FLOW, PASS_ONLY, furthestStep, initialStep, markPassed } from "@/lib/studio/client/steps";
import { stepChangeSave } from "@/lib/studio/client/save-state";

export function useStudioSteps(initial: Extract<LoadResult, { ok: true }> | null, requestedStep: string | null) {
  // Read once: a server-provided first state is applied exactly as a client load would be.
  const [start0] = useState(() => (initial ? initialStep(initial.doc, requestedStep) : 0));
  const [current, setCurrent] = useState(start0);
  const currentRef = useRef(start0);
  const [visited, setVisited] = useState(start0);
  /** After a client load: open `start` as if the visitor had just arrived there. */
  const startAt = (start: number) => {
    setCurrent(start);
    currentRef.current = start;
    setVisited(start);
  };
  return { current, setCurrent, currentRef, visited, setVisited, startAt };
}

export type StudioSteps = ReturnType<typeof useStudioSteps>;

export function useStudioNavigation({
  steps,
  doc,
  latest,
  commit,
  flush,
  ready,
}: {
  steps: StudioSteps;
  doc: StudioDoc | null;
  latest: MutableRefObject<StudioDoc | null>;
  commit: (next: StudioDoc, serverVersion?: number | null) => void;
  flush: () => Promise<void>;
  ready: boolean;
}) {
  const { current, setCurrent, currentRef, visited, setVisited } = steps;
  const furthest = furthestStep(doc, visited);
  const go = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(FLOW.length - 1, i));
      // Leaving Code / Make forwards is what makes them "done" (they have no data of their own).
      const leaving = FLOW[currentRef.current];
      const base = latest.current;
      if (base && idx > currentRef.current && (PASS_ONLY as readonly string[]).includes(leaving)) {
        const answers = markPassed(base.answers, leaving);
        if (answers !== base.answers) commit({ ...base, answers });
      }
      // W1: remember the step on the doc, so the project reopens here (any device, after sign-in).
      const stepSave = stepChangeSave(latest.current, FLOW[idx]);
      if (stepSave.save && stepSave.doc) commit(stepSave.doc);
      currentRef.current = idx;
      void flush();
      setCurrent(idx);
      setVisited((v) => Math.max(v, idx));
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("step", FLOW[idx]);
        url.searchParams.delete("start");
        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
        /* no URL update: fine */
      }
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    // The refs and setters are stable: only flush / commit change the callback.
    [flush, commit, currentRef, latest, setCurrent, setVisited],
  );
  const next = useCallback(() => go(current + 1), [go, current]);

  // W1: the URL always names the open step (?step=), so a sign-in link taken from
  // here returns to exactly this step, even before the visitor moved.
  useEffect(() => {
    if (!ready) return;
    try {
      const url = new URL(window.location.href);
      const step = FLOW[currentRef.current];
      if (url.searchParams.get("step") === step) return;
      url.searchParams.set("step", step);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* no URL update: fine */
    }
  }, [ready, currentRef]);

  return { furthest, go, next };
}

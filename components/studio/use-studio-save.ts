"use client";

// The Studio's save machinery, split out of StudioShell (R8). Owns the doc and
// the refs async code reads (always the latest values):
//
//  * Local edits are saved with PUT + the version (debounced). A conflict is
//    retried once on the server's version; one that persists means another
//    tab saved first: we take its doc. The routes that write
//    themselves (pick / wiring / enclosure) return docVersion, which commit()
//    adopts; pending edits are flushed BEFORE those calls so nothing is lost.
//  * The first load runs here too (it fills the same refs); the shell decides
//    what the loaded doc means for the step and the hand-off via `load`.

import { useCallback, useEffect, useRef, useState } from "react";

import type { StudioDoc } from "@/lib/studio/schema";
import type { LoadResult, StudioApi } from "@/lib/studio/client/api";
import { saveStatus, saveWithConflictRetry, shouldWarnOnLeave, type SaveStatus } from "@/lib/studio/client/save-state";

const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 8000;

type Loaded = Extract<LoadResult, { ok: true }>;

export type StudioLoadHandlers = {
  /** The server already read the first state (no client load): only the hand-off runs. */
  onInitial: (doc: StudioDoc | null) => void;
  /** Client load succeeded; the save refs and the doc are already set. */
  onLoaded: (r: Loaded) => void;
  onError: (error: Extract<LoadResult, { ok: false }>["error"]) => void;
};

export function useStudioSave({
  api,
  initial,
  load,
}: {
  api: StudioApi;
  initial: Loaded | null;
  load: StudioLoadHandlers;
}) {
  const [doc, setDoc] = useState<StudioDoc | null>(initial?.doc ?? null);

  // Save machinery (refs: always the latest values inside async code).
  const latest = useRef<StudioDoc | null>(initial?.doc ?? null);
  const version = useRef(initial?.version ?? 0);
  const persist = useRef(initial?.persist ?? true);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // D4: what the header indicator shows, and the same truth for the beforeunload guard.
  const inFlight = useRef(false);
  const failed = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const statusRef = useRef<SaveStatus>("saved");
  const [guest, setGuest] = useState(false);
  const refreshStatus = useCallback(() => {
    const next = saveStatus({ dirty: dirty.current && persist.current, inFlight: inFlight.current, failed: failed.current });
    statusRef.current = next;
    setStatus(next);
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(async () => {
      if (!dirty.current || !persist.current || !latest.current) {
        refreshStatus();
        return;
      }
      dirty.current = false;
      inFlight.current = true;
      failed.current = false;
      refreshStatus();
      const r = await saveWithConflictRetry((d, v) => api.save(d, v), latest.current, version.current);
      inFlight.current = false;
      if (r.ok) version.current = r.version;
      else if (r.error === "conflict") {
        // Still conflicting after the retry: another tab really did save first.
        // Theirs wins, ours is dropped.
        version.current = r.version;
        if (r.doc) {
          latest.current = r.doc;
          setDoc(r.doc);
        }
      } else if (r.error === "run_0068") persist.current = false;
      else {
        // Network blip: keep the change, show "Not saved", and try again shortly.
        dirty.current = true;
        failed.current = true;
        if (!timer.current) timer.current = setTimeout(() => void flush(), RETRY_DELAY_MS);
      }
      refreshStatus();
    });
    return chain.current;
  }, [api, refreshStatus]);

  /** Apply a new doc. `serverVersion` = the route already saved it (no PUT). */
  const commit = useCallback(
    (next: StudioDoc, serverVersion?: number | null) => {
      latest.current = next;
      setDoc(next);
      if (typeof serverVersion === "number") {
        version.current = serverVersion;
        return;
      }
      dirty.current = true;
      failed.current = false;
      refreshStatus();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, refreshStatus],
  );

  // Load once (skipped when the server already did; the /projects/new hand-off still runs).
  const [initialUsed] = useState(() => initial);
  useEffect(() => {
    let alive = true;
    if (initialUsed) {
      load.onInitial(initialUsed.doc);
      return;
    }
    void api.load().then((r) => {
      if (!alive) return;
      if (!r.ok) {
        load.onError(r.error);
        return;
      }
      latest.current = r.doc;
      version.current = r.version;
      persist.current = r.persist;
      setDoc(r.doc);
      load.onLoaded(r);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per project
  }, [api]);

  // Save what is pending when the page goes away.
  useEffect(() => {
    const onHide = () => void flush();
    // D4: while a change is unsaved (pending, in flight or failed) the browser asks before closing.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldWarnOnLeave(statusRef.current, persist.current)) return;
      void flush();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving through an in-app link (Dashboard, header): save what is pending.
      void flush();
    };
  }, [flush]);

  // Guests are saved on this device's session: the indicator says so.
  useEffect(() => {
    let alive = true;
    void api.isGuest?.().then((g) => alive && setGuest(g)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  return { doc, latest, version, persist, status, guest, flush, commit };
}

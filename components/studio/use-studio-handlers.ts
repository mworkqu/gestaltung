"use client";

// What each Studio step reports back, applied to the doc (split out of
// StudioShell, R8). Every handler reads the latest doc from the save refs and
// goes through commit(), so a route's docVersion is adopted the same way.

import { useCallback, useState, type MutableRefObject } from "react";

import {
  emptyStudioDoc,
  type EnclosureSpec,
  type Finish,
  type LibraryPart,
  type MechPart,
  type ProductSpec,
  type StudioComponent,
  type StudioDoc,
  type StudioProduct,
} from "@/lib/studio/schema";
import type { StudioApi } from "@/lib/studio/client/api";
import { FLOW, passedAnswers, sameSpec } from "@/lib/studio/client/steps";
import { PRODUCT_FINISH_KEY } from "./use-product";

/** P5-17: the same main board (MCU part) before and after a change — the client's code still fits. */
function sameBoard(a: StudioComponent[], b: StudioComponent[], getPart: (id: string) => LibraryPart | undefined): boolean {
  const board = (cs: StudioComponent[]) => cs.find((c) => getPart(c.partId)?.category === "mcu")?.partId ?? null;
  const x = board(a);
  return x !== null && x === board(b);
}

export function useStudioHandlers({
  api,
  latest,
  version,
  commit,
  flush,
  go,
  getPart,
}: {
  api: StudioApi;
  latest: MutableRefObject<StudioDoc | null>;
  version: MutableRefObject<number>;
  commit: (next: StudioDoc, serverVersion?: number | null) => void;
  flush: () => Promise<void>;
  go: (i: number) => void;
  getPart: (id: string) => LibraryPart | undefined;
}) {
  // ── Step results ─────────────────────────────────────────────────────────
  /** The doc for a card: the same card keeps everything; a changed card redoes the parts and after. */
  const docForCard = useCallback((spec: ProductSpec, answers: Record<string, string>): StudioDoc => {
      const prev = latest.current;
      const base = prev ?? emptyStudioDoc(spec);
      const same = prev ? sameSpec(prev.spec, spec) : false;
      return same
        ? { ...base, answers: { ...passedAnswers(base.answers), ...answers } }
        : {
            ...base,
            spec,
            answers,
            // A different idea: the parts and everything after are redone.
            components: [],
            netlist: { nets: [] },
            checks: [],
            enclosure: null,
            enclosureVersions: [],
            layout: [],
            mech: [],
            firmware: undefined,
            product: undefined,
          };
  }, [latest]);

  const onIdeaConfirmed = useCallback(
    (spec: ProductSpec, answers: Record<string, string>) => {
      commit(docForCard(spec, answers));
      void api.rename(spec.name);
      go(FLOW.indexOf("parts"));
    },
    [api, commit, go, docForCard],
  );

  // 2026-10-18 (owner): a card the chat changed is saved at once, not only on the main
  // button — so the Parts step (reached from the progress line too) always picks for the
  // card on screen. Same rule as confirming: a changed card clears the old parts.
  const onIdeaDraft = useCallback(
    (spec: ProductSpec, answers: Record<string, string>) => {
      const prev = latest.current;
      if (prev && sameSpec(prev.spec, spec)) return;
      commit(docForCard(spec, answers));
    },
    [commit, docForCard, latest],
  );

  const onComponents = useCallback(
    (components: StudioComponent[], serverVersion: number | null, edited: boolean) => {
      const base = latest.current;
      if (!base) return;
      commit(
        edited
          ? // A changed list: the old circuit and layout no longer apply.
            {
              ...base,
              components,
              netlist: { nets: [] },
              checks: [],
              layout: [],
              mech: [],
              // P5-17: same board → the client's code stays; the Code step swaps only its pin block.
              firmware: sameBoard(base.components, components, getPart) ? base.firmware : undefined,
            }
          : { ...base, components },
        edited ? undefined : serverVersion,
      );
    },
    [commit, getPart, latest],
  );

  const onWiring = useCallback(
    (w: { components: StudioComponent[]; netlist: StudioDoc["netlist"]; checks: StudioDoc["checks"] }, serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      // A different circuit on the same board keeps the code (the Code step updates only the
      // pin block, P5-17); another board drops it.
      const same =
        !base.firmware ||
        JSON.stringify(base.netlist) === JSON.stringify(w.netlist) ||
        sameBoard(base.components, w.components, getPart);
      if (same) {
        commit({ ...base, components: w.components, netlist: w.netlist, checks: w.checks }, serverVersion);
        return;
      }
      // The route saved the circuit; dropping the code is ours to save on top of it.
      if (typeof serverVersion === "number") version.current = serverVersion;
      commit({ ...base, components: w.components, netlist: w.netlist, checks: w.checks, firmware: undefined });
    },
    [commit, getPart, latest, version],
  );

  const onEnclosure = useCallback(
    (
      enclosure: EnclosureSpec,
      opts: { serverVersion?: number | null; fresh?: boolean; layout?: StudioDoc["layout"]; reshape?: boolean },
    ) => {
      const base = latest.current;
      if (!base) return;
      const versions = opts.fresh ? [...(base.enclosureVersions ?? []), enclosure].slice(-3) : base.enclosureVersions;
      // A new look (or another shape picked under "Other shapes") changes the case's size:
      // its printed parts are worked out again.
      const nextDoc: StudioDoc = {
        ...base,
        enclosure,
        enclosureVersions: versions,
        layout: opts.layout ?? base.layout,
        ...(opts.fresh || opts.reshape ? { mech: [] } : {}),
      };
      if (opts.fresh && typeof opts.serverVersion === "number") {
        // The route saved the enclosure; the layout is ours to add.
        version.current = opts.serverVersion;
      }
      commit(nextDoc);
    },
    [commit, latest, version],
  );

  const onMech = useCallback(
    (mech: MechPart[], serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, mech }, serverVersion);
    },
    [commit, latest],
  );

  const onFirmware = useCallback(
    (firmware: { board: string; code: string }, serverVersion: number | null) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, firmware }, serverVersion);
    },
    [commit, latest],
  );

  const flushBeforeServer = useCallback(() => flush(), [flush]);

  // ── P5-17 wiring views ↔ code: one wire highlighted across steps ─────────
  const [wireFocus, setWireFocus] = useState<{ id: string; step: "wiring" | "code"; n: number } | null>(null);
  const showInCode = useCallback(
    (id: string) => {
      setWireFocus((f) => ({ id, step: "code", n: (f?.n ?? 0) + 1 }));
      go(FLOW.indexOf("code"));
    },
    [go],
  );
  const showInWiring = useCallback(
    (id: string) => {
      setWireFocus((f) => ({ id, step: "wiring", n: (f?.n ?? 0) + 1 }));
      go(FLOW.indexOf("wiring"));
    },
    [go],
  );
  const onWiringTicks = useCallback(
    (wiringTicks: string[]) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, wiringTicks });
    },
    [commit, latest],
  );

  // ── P5-16 product designs (pictures in the background after Parts) ───────
  const onProduct = useCallback(
    (update: (prev: StudioProduct | undefined) => StudioProduct) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, product: update(base.product) });
    },
    [commit, latest],
  );
  const onProductFinish = useCallback(
    (finish: Finish) => {
      const base = latest.current;
      if (!base) return;
      commit({ ...base, answers: { ...(base.answers ?? {}), [PRODUCT_FINISH_KEY]: finish } });
    },
    [commit, latest],
  );

  return {
    onIdeaConfirmed,
    onIdeaDraft,
    onComponents,
    onWiring,
    onEnclosure,
    onMech,
    onFirmware,
    flushBeforeServer,
    wireFocus,
    showInCode,
    showInWiring,
    onWiringTicks,
    onProduct,
    onProductFinish,
  };
}

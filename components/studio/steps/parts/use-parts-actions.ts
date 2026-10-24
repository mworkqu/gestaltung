"use client";

// The Parts step's list changes, split out of PartsStep (R8).

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useStudioLibrary } from "../../StudioLibraryProvider";
import type { LibraryPart, StudioComponent, StudioDoc } from "@/lib/studio/schema";
import { nextInstanceId } from "@/lib/studio/client/steps";
import type { StudioCtx } from "../../studio-ctx";
import { applyCardColours, cardCoverage } from "@/lib/studio/card-parts";
import { problemKey } from "../problem";

/**
 * What changes the parts list: the automatic pick (on first entry, and "Try again"),
 * Swap, Add and Remove (edit), and the card's colours on parts picked before colours
 * were kept. Owns the pick's busy / problem state.
 */
export function usePartsActions({
  ctx,
  doc,
  beforeServer,
  onComponents,
  onSwapped,
  onAdded,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onComponents: (components: StudioComponent[], serverVersion: number | null, edited: boolean) => void;
  /** After a swap: close the swap sheet. */
  onSwapped: () => void;
  /** After an add: close the add sheet. */
  onAdded: () => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  async function pick() {
    setBusy(true);
    setProblem(null);
    await beforeServer();
    const r = await ctx.api.pick(doc.spec, locale);
    setBusy(false);
    if (!r.ok) {
      setProblem(t(problemKey(r)));
      return;
    }
    onComponents(r.data.components, r.data.docVersion, false);
  }

  useEffect(() => {
    if (started.current) return;
    // No parts yet, or parts picked before the card gained something it shows (a project
    // saved before 2026-10-18: "3 LEDs" on the card, none in the list) → pick for the card.
    const stale = doc.components.length > 0 && cardCoverage(doc.spec, doc.components, (id) => !!getPart(id)).length > 0;
    if (doc.components.length > 0 && !stale) return;
    started.current = true;
    void pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on entry
  }, []);

  const edit = (next: StudioComponent[]) => onComponents(next.filter((c) => !c.auto), null, true);

  // The card's colours on parts picked before colours were kept (2026-10-18): "green, yellow and
  // red LEDs" → each LED gets its colour once. Colour only: the circuit and layout stay.
  useEffect(() => {
    if (!doc.components.length) return;
    const coloured = applyCardColours(doc.spec, doc.components);
    if (coloured.some((c, i) => c.variant !== doc.components[i].variant)) onComponents(coloured, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the parts and the card
  }, [doc.components, doc.spec]);

  // Part D: a row stands for every identical part ("Servo × 3"): Swap swaps them all.
  function swap(target: StudioComponent, part: LibraryPart) {
    const next: StudioComponent[] = [];
    for (const c of doc.components) {
      next.push(
        c.partId === target.partId && !c.auto
          ? { partId: part.id, instanceId: nextInstanceId(part.id, [...doc.components, ...next]), label: part.name[locale], reason: part.blurb[locale] }
          : c,
      );
    }
    edit(next);
    onSwapped();
  }

  function add(part: LibraryPart) {
    edit([
      ...doc.components,
      { partId: part.id, instanceId: nextInstanceId(part.id, doc.components), label: part.name[locale], reason: part.blurb[locale] },
    ]);
    onAdded();
  }

  return { busy, problem, pick, edit, swap, add };
}

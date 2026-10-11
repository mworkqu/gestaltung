"use client";

// Wiring tab (P5-17): the Fritzing-style drawing of the real boards with every
// pin labelled and smooth coloured wires (lib/studio/wiring-drawing.ts), in the
// same zoom / pan / fit / full-screen frame as the schematic. Click a wire to
// select it everywhere; hover previews it. While the build guide runs the
// finished wires are normal, the current one draws in and the rest are faint.

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { Locale } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";
import { renderWiringSVG } from "@/lib/studio/wiring-drawing";
import { SchematicFrame } from "./SchematicFrame";
import { useWiringViews } from "./views-context";

export function WiringDrawingView({ doc, locale }: { doc: StudioDoc; locale: Locale }) {
  const t = useTranslations("Studio.views.drawing");
  const { connections, getPart, activeId, hoverId, guide, select, setHover } = useWiringViews();

  // Built once per circuit: selection and the guide only toggle classes on it.
  const svg = useMemo(
    () => renderWiringSVG(doc.components, doc.netlist.nets, getPart, { locale, connections }),
    [doc.components, doc.netlist.nets, getPart, locale, connections],
  );
  const guideMarks = useMemo(
    () =>
      guide === null
        ? null
        : { current: connections[guide]?.id ?? null, later: new Set(connections.slice(guide + 1).map((c) => c.id)) },
    [guide, connections],
  );

  return (
    <SchematicFrame
      svg={svg}
      label={t("label")}
      // While the guide runs only a hovered wire dims the others.
      activeId={guide === null ? activeId : hoverId}
      onPick={select}
      onHover={setHover}
      guide={guideMarks}
    />
  );
}

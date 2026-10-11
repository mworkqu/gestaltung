"use client";

// Schematic tab (P5-17): the W5 drawing with the shared colours and ids
// (lib/studio/connections.ts). A wire or net flag carries data-conn (one of its
// connections) and data-net; picking one selects that connection everywhere,
// and the selection lights up every wire and flag on the same net.

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { Locale } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";
import { SchematicFrame } from "./SchematicFrame";
import { useWiringViews } from "./views-context";

export function SchematicView({ doc, svg, locale }: { doc: StudioDoc; svg: string; locale: Locale }) {
  const t = useTranslations("Studio");
  const { byId, activeId, select, setHover } = useWiringViews();
  void doc;
  void locale;
  const activeNet = useMemo(() => (activeId ? byId.get(activeId)?.net ?? null : null), [activeId, byId]);
  return (
    <SchematicFrame
      svg={svg}
      label={t("schematicLabel")}
      activeNet={activeNet}
      onPick={select}
      onHover={setHover}
    />
  );
}

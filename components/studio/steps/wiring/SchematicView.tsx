"use client";

// P5-17 placeholder — the schematic with shared ids/colours replaces this.

import { useTranslations } from "next-intl";

import type { Locale } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";
import { SchematicFrame } from "./SchematicFrame";

export function SchematicView({ doc, svg, locale }: { doc: StudioDoc; svg: string; locale: Locale }) {
  const t = useTranslations("Studio");
  void doc;
  void locale;
  return <SchematicFrame svg={svg} label={t("schematicLabel")} />;
}

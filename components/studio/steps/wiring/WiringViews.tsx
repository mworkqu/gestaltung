"use client";

// Wiring step views (P5-17): four tabs over ONE Connection[] — Wiring (flat
// drawing of the real boards), 3D (the parts with wires on them), Schematic
// (the W5 drawing) and Pin list (the checklist). Tabs are views, not steps:
// the step keeps its one main button. "Wiring" opens first; the last tab
// chosen is remembered in this browser. Selecting a wire anywhere highlights
// it in every tab (views-context.tsx).
//
// Every tab body is loaded on demand (next/dynamic), so the Studio's first
// load does not grow: the 3D tab only loads three.js work when it is opened.

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useRef, type KeyboardEvent } from "react";

import { STEP_ACCENT } from "@/lib/studio/palette";
import type { Locale } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";
import { useStudioLibrary } from "../../StudioLibraryProvider";
import { Bar } from "../../ui";
import { SelectedWire } from "./SelectedWire";
import { WIRING_TABS, WiringViewsProvider, useWiringViews, type WiringTab } from "./views-context";

const accent = STEP_ACCENT.wiring;

function PanelSkeleton() {
  const t = useTranslations("Studio.views");
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">{t("viewLoading")}</span>
      <Bar className="h-[min(60dvh,560px)] w-full rounded-[20px]" />
    </div>
  );
}

const WiringDrawingView = dynamic(() => import("./WiringDrawingView").then((m) => m.WiringDrawingView), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const Wiring3DView = dynamic(() => import("./Wiring3DView").then((m) => m.Wiring3DView), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const SchematicView = dynamic(() => import("./SchematicView").then((m) => m.SchematicView), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const PinListView = dynamic(() => import("./PinListView").then((m) => m.PinListView), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const BuildGuide = dynamic(() => import("./BuildGuide").then((m) => m.BuildGuide), { ssr: false });

export function WiringViews({
  doc,
  schematicSvg,
  engineer,
  locale,
  focusId,
  onTicks,
  onShowInCode,
}: {
  doc: StudioDoc;
  schematicSvg: string;
  engineer: boolean;
  locale: Locale;
  focusId: string | null;
  onTicks: (ticks: string[]) => void;
  onShowInCode?: (id: string) => void;
}) {
  const { getPart } = useStudioLibrary();
  return (
    <WiringViewsProvider
      doc={doc}
      getPart={getPart}
      engineer={engineer}
      initialSelected={focusId}
      onTicks={onTicks}
      showInCode={onShowInCode}
    >
      <Tabs />
      <Panels doc={doc} schematicSvg={schematicSvg} locale={locale} />
    </WiringViewsProvider>
  );
}

const TAB_KEY: Record<WiringTab, "tabWiring" | "tab3d" | "tabSchematic" | "tabPins"> = {
  wiring: "tabWiring",
  "3d": "tab3d",
  schematic: "tabSchematic",
  pins: "tabPins",
};

/** Segmented control (also on phones): a real tablist with arrow-key moves. */
function Tabs() {
  const t = useTranslations("Studio.views");
  const { tab, setTab } = useWiringViews();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const i = WIRING_TABS.indexOf(tab);
      const rtl = document.documentElement.dir === "rtl";
      let n = i;
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) n = (i + 1) % WIRING_TABS.length;
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) n = (i - 1 + WIRING_TABS.length) % WIRING_TABS.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = WIRING_TABS.length - 1;
      else return;
      e.preventDefault();
      setTab(WIRING_TABS[n]);
      refs.current[n]?.focus();
    },
    [tab, setTab],
  );
  return (
    <div
      role="tablist"
      aria-label={t("tabsLabel")}
      onKeyDown={onKey}
      className="grid grid-cols-4 gap-1 rounded-full bg-surface p-1 shadow-neu-inset"
      data-testid="studio-wiring-tabs"
    >
      {WIRING_TABS.map((id, i) => {
        const on = id === tab;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`studio-wiring-tab-${id}`}
            aria-selected={on}
            aria-controls={`studio-wiring-panel-${id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => setTab(id)}
            data-testid={`studio-wiring-tab-${id}`}
            className="min-h-11 rounded-full px-1 text-center text-xs font-semibold leading-tight sm:px-2 sm:text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={on ? { background: accent.base, color: "#1c2434" } : { color: "#475569" }}
          >
            {t(TAB_KEY[id])}
          </button>
        );
      })}
    </div>
  );
}

function Panels({ doc, schematicSvg, locale }: { doc: StudioDoc; schematicSvg: string; locale: Locale }) {
  const { tab } = useWiringViews();
  const guided = tab === "wiring" || tab === "3d";
  return (
    <div
      role="tabpanel"
      id={`studio-wiring-panel-${tab}`}
      aria-labelledby={`studio-wiring-tab-${tab}`}
      className="space-y-3"
      data-testid={`studio-wiring-panel-${tab}`}
    >
      {guided && <BuildGuide locale={locale} />}
      {tab === "wiring" && <WiringDrawingView doc={doc} locale={locale} />}
      {tab === "3d" && <Wiring3DView doc={doc} locale={locale} />}
      {tab === "schematic" && <SchematicView doc={doc} svg={schematicSvg} locale={locale} />}
      {tab === "pins" && <PinListView doc={doc} locale={locale} />}
      {tab !== "pins" && <SelectedWire locale={locale} />}
    </div>
  );
}

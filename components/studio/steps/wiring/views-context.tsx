"use client";

// Wiring views (P5-17): the state every view of the circuit shares.
//
// One Connection[] (lib/studio/connections.ts) feeds the Wiring drawing, the 3D
// wires, the schematic and the pin list. Selecting a wire in any of them sets
// `selectedId` here, so the others highlight it too and switching tabs keeps
// the selection. The build guide ("Wire it step by step") walks the same list
// in build order (ground → power → signals). Nothing here costs credits.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { buildConnections, connectionKey, type Connection } from "@/lib/studio/connections";
import type { GetPart } from "@/lib/studio/netlist";
import type { StudioDoc } from "@/lib/studio/schema";

export const WIRING_TABS = ["wiring", "3d", "schematic", "pins"] as const;
export type WiringTab = (typeof WIRING_TABS)[number];
const TAB_KEY = "gestaltung:studio:wiring-tab";

export type WiringViews = {
  connections: Connection[];
  byId: Map<string, Connection>;
  selectedId: string | null;
  /** Select (or clear with null). Selecting the selected wire again clears it. */
  select: (id: string | null) => void;
  /** Hover preview (does not change the selection). */
  hoverId: string | null;
  setHover: (id: string | null) => void;
  /** The wire to emphasise right now: hover wins over selection. */
  activeId: string | null;
  tab: WiringTab;
  setTab: (t: WiringTab) => void;
  /** Build guide: index into `connections` while the guide runs, else null. */
  guide: number | null;
  setGuide: (i: number | null) => void;
  /** Pin-list ticks (connectionKey). */
  ticked: ReadonlySet<string>;
  toggleTick: (c: Connection) => void;
  /** Engineer view (super_admin): ids and rule-check details are shown. */
  engineer: boolean;
  /** Opens the Code step at the lines that use this wire. */
  showInCode?: (id: string) => void;
  getPart: GetPart;
};

const Ctx = createContext<WiringViews | null>(null);

export function useWiringViews(): WiringViews {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWiringViews outside WiringViewsProvider");
  return v;
}

export function WiringViewsProvider({
  doc,
  getPart,
  engineer,
  initialSelected,
  onTicks,
  showInCode,
  children,
}: {
  doc: StudioDoc;
  getPart: GetPart;
  engineer: boolean;
  /** A wire to open selected (from "Show in wiring" in the Code step). */
  initialSelected?: string | null;
  onTicks: (ticks: string[]) => void;
  showInCode?: (id: string) => void;
  children: ReactNode;
}) {
  const connections = useMemo(
    () => buildConnections(doc.components, doc.netlist.nets, getPart, doc.spec),
    [doc.components, doc.netlist.nets, getPart, doc.spec],
  );
  const byId = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected ?? null);
  const [hoverId, setHover] = useState<string | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [tab, setTabState] = useState<WiringTab>("wiring");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      if (saved && (WIRING_TABS as readonly string[]).includes(saved)) setTabState(saved as WiringTab);
    } catch {
      /* storage blocked: start on Wiring */
    }
  }, []);
  useEffect(() => {
    if (initialSelected) setSelectedId(initialSelected);
  }, [initialSelected]);
  // A rewired circuit can drop the selected id.
  useEffect(() => {
    if (selectedId && !byId.has(selectedId)) setSelectedId(null);
  }, [byId, selectedId]);

  const setTab = useCallback((t: WiringTab) => {
    setTabState(t);
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not remembered: fine */
    }
  }, []);
  const select = useCallback((id: string | null) => setSelectedId((cur) => (id && cur === id ? null : id)), []);

  const ticks = doc.wiringTicks;
  const ticked = useMemo(() => new Set(ticks ?? []), [ticks]);
  const toggleTick = useCallback(
    (c: Connection) => {
      const k = connectionKey(c);
      const next = new Set(ticked);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      // Only keys of wires that still exist are kept.
      const live = new Set(connections.map(connectionKey));
      onTicks([...next].filter((x) => live.has(x)));
    },
    [ticked, connections, onTicks],
  );

  const guideId = guide !== null ? connections[guide]?.id ?? null : null;
  const value: WiringViews = {
    connections,
    byId,
    selectedId: guideId ?? selectedId,
    select,
    hoverId,
    setHover,
    activeId: hoverId ?? guideId ?? selectedId,
    tab,
    setTab,
    guide,
    setGuide,
    ticked,
    toggleTick,
    engineer,
    showInCode,
    getPart,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

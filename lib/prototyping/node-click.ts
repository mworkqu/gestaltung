// Where a click on a sidebar node goes (audit #30). Pure, so it can be tested.
//
// A node that can't proceed carries a reason and, usually, the node that
// resolves it. Clicking goes there. When you are already standing on the fix,
// going "there" would change nothing — a dead click — so instead the control
// that resolves it is brought into view, or, failing that, the node itself
// opens. A click therefore always does something visible.

import type { NodeId, NodeState } from "./tree";

export type NodeClick = { to: NodeId; focus?: string };

export function nodeClick(n: NodeId, st: NodeState | undefined, current: NodeId): NodeClick {
  if (st?.reason && st.target && st.target !== n) {
    if (st.target !== current) return st.focus ? { to: st.target, focus: st.focus } : { to: st.target };
    if (st.focus) return { to: current, focus: st.focus };
  }
  return { to: n };
}

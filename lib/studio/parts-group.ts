// Part D: identical parts shown once with a quantity ("MG996R servo × 3").
//
// The doc keeps one StudioComponent per physical part (instance ids mg996r_servo_1,
// _2, _3 — wiring, layout and 3D need each one); lists, the parts total, the cart
// and the Get it made summary group them by part id. Parts the wiring added on its
// own (auto) never merge with ones the visitor chose. Pure; first-seen order.

import type { StudioComponent } from "./schema";

export type PartGroup = {
  /** Stable key: the first instance id of the group. */
  key: string;
  partId: string;
  auto: boolean;
  items: StudioComponent[];
  quantity: number;
  first: StudioComponent;
};

export function groupComponents(components: readonly StudioComponent[]): PartGroup[] {
  const byKey = new Map<string, PartGroup>();
  const out: PartGroup[] = [];
  for (const c of components) {
    const k = `${c.partId}|${c.auto ? "auto" : "chosen"}`;
    const g = byKey.get(k);
    if (g) {
      g.items.push(c);
      g.quantity++;
      continue;
    }
    const fresh: PartGroup = { key: c.instanceId, partId: c.partId, auto: Boolean(c.auto), items: [c], quantity: 1, first: c };
    byKey.set(k, fresh);
    out.push(fresh);
  }
  return out;
}

/** Does the group hold this instance? */
export const groupHas = (g: PartGroup, instanceId: string | null | undefined) =>
  !!instanceId && g.items.some((c) => c.instanceId === instanceId);

/** "MG996R servo × 3" (Western digits in both languages); the plain name for one. */
export const withQuantity = (name: string, quantity: number) => (quantity > 1 ? `${name} × ${quantity}` : name);

/** Pieces per part id (all instances, auto ones too). */
export function quantities(components: readonly { partId: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of components) m.set(c.partId, (m.get(c.partId) ?? 0) + 1);
  return m;
}

// Board and power chosen for the client (client view, P5-04).
//
// The engineer view asks for Board (Prototype or Custom PCB), then Power (plug
// adapter, battery, solar), then Components. The client view never shows those
// steps, so before a circuit is drawn the two choices are made from what is
// already known, with the same defaults the engineer view starts from:
//   board  the saved build route, else "prototype" (dev boards and modules,
//          parts available now; Custom PCB stays an engineer-view decision)
//   power  the client's own power answer, else what the brief says
//          (engine.powerSource), else a plug-in adapter
// Pure and client-safe.

import type { BuildRoute } from "./analysis";
import { powerSource } from "./engine";
import { rowOf, type Spec } from "./spec";

export const POWER_VALUES = ["mains", "battery", "solar"] as const;
export type PowerValue = (typeof POWER_VALUES)[number];

const isPower = (v: unknown): v is PowerValue => typeof v === "string" && (POWER_VALUES as readonly string[]).includes(v);

export const autoBoard = (route: BuildRoute | null | undefined): BuildRoute => route ?? "prototype";

/** The power source to build for: answer first, then the brief, then the plug-in adapter. */
export function autoPower(spec: Spec | null | undefined, brief: string | null | undefined): PowerValue {
  const answered = rowOf(spec ?? null, "power")?.value;
  if (isPower(answered)) return answered;
  const fromBrief = powerSource(brief ?? "");
  return fromBrief ?? "mains";
}

/** What has to be saved before the electronics can be built. */
export function autoSetup({
  route,
  spec,
  brief,
}: {
  route: BuildRoute | null | undefined;
  spec: Spec | null | undefined;
  brief: string | null | undefined;
}): { route: BuildRoute; needsRoute: boolean; power: PowerValue; needsPower: boolean } {
  const answered = rowOf(spec ?? null, "power")?.value;
  return {
    route: autoBoard(route),
    needsRoute: !route,
    power: autoPower(spec, brief),
    needsPower: !isPower(answered),
  };
}

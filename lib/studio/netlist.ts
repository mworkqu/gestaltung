// Design Studio wiring: DETERMINISTIC code, never AI.
//
// The picker (AI) only chooses parts from our library. Everything below turns
// that list into a circuit with plain rules over pin ROLES (never per part):
//   resolveRequired()  adds the helpers the parts need (a resistor per LED, a
//                      level shifter where a 5 V signal would reach a 3.3 V
//                      board, a driver for a motor) when the library has them;
//   buildNetlist()     power topology, shared buses, one board pin per signal;
//   toLegacyNetlist()  the lib/prototyping/netlist.ts shape, so the existing
//                      rule engine (hardRules / sanityChecks / powerBudget) and
//                      the firmware generator work on Studio circuits unchanged;
//   buildWiring()      the one call the API and UI use.
//
// Pure and client-safe. Same input → same output, byte for byte.
//
// Split by stage (R8); this file is the stable import path and re-exports the
// public API of:
//   netlist-parts.ts     part classification, refs, charger pins, rail ranges
//   netlist-power.ts     power plan (Rail)
//   netlist-required.ts  resolveRequired, ADDED_REASON
//   netlist-build.ts     buildNetlist
//   netlist-legacy.ts    toLegacyNetlist, legacyFunction, buildWiring

// netlist-parts is also imported directly by plain-checks.ts (no cycle through this file).
export {
  isPowerRole,
  isSignalRole,
  tagged,
  isMcu,
  isCharger,
  isBattery,
  isShifter,
  isConverter,
  isPowerSource,
  symbolKind,
  isSeriesHelper,
  isButton,
  isInductive,
  isServoDriver,
  isDriver,
  servoChannelOf,
  openByDesign,
  LEVEL_SHIFTER_IDS,
  DRIVER_IDS,
  SWITCH_DRIVER_IDS,
  HBRIDGE_DRIVER_IDS,
  isOnOffLoad,
  isHBridge,
  isLowSideSwitch,
  loadPath,
  driverSuits,
  BOOSTER_IDS,
  splitRef,
  chargerPins,
  RAIL_RANGE,
  DEV_TO_MCU,
  MCU_TO_DEV,
  servoSupplyRail,
  shifterChannels,
} from "./netlist-parts";
export type { GetPart, Locale, SymbolKind, ChargerPins } from "./netlist-parts";
export type { Rail } from "./netlist-power";
export { ADDED_REASON, resolveRequired } from "./netlist-required";
export type { AddedComponent, AddedReason } from "./netlist-required";
export { buildNetlist } from "./netlist-build";
export type { BuildResult } from "./netlist-build";
export { buildWiring, legacyFunction, toLegacyNetlist } from "./netlist-legacy";
export type { WiringResult } from "./netlist-legacy";

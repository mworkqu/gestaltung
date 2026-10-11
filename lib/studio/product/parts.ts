// Which library parts need a special physical home in a product (P5-16).
// Read from the part's id / category / tags / ports only, so owner-added parts
// (studio_parts) are classified the same way.

import type { LibraryPart, PortKind } from "../schema";

const tagged = (p: LibraryPart, ...words: string[]) => p.tags.some((t) => words.includes(t.toLowerCase()));

/** A water pump: lives in the reservoir. (A relay tagged "pump" — it can switch one — is not.) */
export const isPump = (p: LibraryPart): boolean =>
  /pump/.test(p.id) || (p.category === "actuator" && tagged(p, "pump") && tagged(p, "water", "submersible") && !tagged(p, "relay", "driver"));
/** A soil probe: lives in the stake, its blade in the soil. */
export const isSoilProbe = (p: LibraryPart): boolean => p.category === "sensor" && tagged(p, "soil");
/** A light: shines through a clear ring / window. */
export const isLight = (p: LibraryPart): boolean =>
  p.id === "led_5mm" || p.id === "ws2812_ring" || (p.category === "output" && tagged(p, "led", "neopixel", "ws2812", "rgb", "light"));
/** A push button on top: gets a printed button cap. */
export const isButtonPart = (p: LibraryPart): boolean => p.ports.some((q) => q.kind === "button_cap" && q.face === "+z");

/** Ports a cable plugs into (must be on a face the user can reach). */
export const POWER_PORTS: readonly PortKind[] = ["usb_c", "usb_micro", "usb_b", "dc_jack"];

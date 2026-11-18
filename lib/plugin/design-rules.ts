/**
 * What a client's AI may design with (get_design_rules + the MCP resource
 * gestaltung://design-rules). Pure and JSON-serialisable. Never a SKU, a price, a cost or a
 * margin: the model proposes functions by library id, our code decides products and prices.
 */
import { COLOURS, ENCLOSURE_TEMPLATES, FINISHES, PHASE_TEMPLATES, type LibraryPart, type PinRole } from "@/lib/studio/schema";
import { BUILD_LIMITS, EXAMPLE_BUILD_FILE, buildFileJsonSchema, type BuildFileInput } from "./build-file";
import { directHelperIds, type PluginLibrary } from "./to-studio";

export type DesignRulePart = {
  id: string;
  name: string;
  category: string;
  voltage: string;
  logic_v: number;
  current_ma: number;
  pins_summary: string;
  sold_in_store: boolean;
};

export type DesignRules = {
  version: 1;
  parts: DesignRulePart[];
  enclosure: { templates: string[]; colours: string[]; finishes: string[]; label_max: number };
  making: {
    printer: string;
    build_volume_mm: [number, number, number];
    min_wall_mm: number;
    processes: string[];
    method_note: string;
  };
  rules: string[];
  build_file: { json_schema: Record<string, unknown>; example: BuildFileInput };
};

const ROLE_GROUP: Partial<Record<PinRole, string>> = {
  gpio: "GPIO", adc: "GPIO", pwm: "GPIO", in: "GPIO", out: "GPIO",
  i2c_sda: "I2C", i2c_scl: "I2C",
  spi_mosi: "SPI", spi_miso: "SPI", spi_sck: "SPI", spi_cs: "SPI",
  uart_tx: "UART", uart_rx: "UART",
  "3v3": "3V3", "5v": "5V", vin: "VIN", gnd: "GND",
};

/** Short pin line: the pin ids for a small part, grouped counts for a board or a driver. */
export function pinsSummary(p: LibraryPart): string {
  if (!p.pins.length) return "no pins";
  if (p.pins.length <= 8) return [...new Set(p.pins.map((x) => x.id))].join(", ");
  const counts = new Map<string, number>();
  for (const pin of p.pins) {
    const g = ROLE_GROUP[pin.role] ?? pin.role;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const order = ["GPIO", "I2C", "SPI", "UART", "3V3", "5V", "VIN", "GND"];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const keys = [...counts.keys()].sort((a, b) => rank(a) - rank(b));
  return `${p.pins.length} pins: ` + keys.map((k) => (k === "GPIO" || k === "GND" ? `${counts.get(k)} ${k}` : k)).join(", ");
}

const num = (n: number) => String(Math.round(n * 100) / 100);

export function designRules(lib: PluginLibrary, opts: { minWallMm: number }): DesignRules {
  const direct = directHelperIds(lib);
  const parts = lib.parts
    .filter((p) => !p.helper || direct.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name.en,
      category: p.category,
      voltage: `${num(p.power.vMin)}–${num(p.power.vMax)} V`,
      logic_v: p.power.logicV,
      current_ma: p.power.mA,
      pins_summary: pinsSummary(p),
      sold_in_store: p.storeSkus.length > 0,
    }));
  // The templates the Studio's renderer offers (the enclosure route's AI_TEMPLATES = PHASE_TEMPLATES).
  const templates = ENCLOSURE_TEMPLATES.filter((t) => PHASE_TEMPLATES.includes(t));
  return {
    version: 1,
    parts,
    enclosure: { templates, colours: [...COLOURS], finishes: [...FINISHES], label_max: BUILD_LIMITS.lookLabel },
    making: {
      printer: "Prusa MK4",
      build_volume_mm: [250, 210, 220],
      min_wall_mm: opts.minWallMm,
      processes: ["3D printing", "CNC machining", "laser cutting", "EDM"],
      method_note: "Our engineer reviews your file and quotes the best method within one working day.",
    },
    rules: [
      "Pick parts only by the ids in this list; never invent an id.",
      "One controller board per product; our rules add one if none is chosen.",
      "One power source per product (USB, battery or wall adapter).",
      "We always recompute the wiring and the pin numbers in the code from your parts.",
      "Never send the project without the user's explicit agreement.",
      "Never send the chat itself; send only the build file.",
      `Add up to ${BUILD_LIMITS.quotes} short quotes of the client's own words for key requirements (max ${BUILD_LIMITS.short} characters each).`,
      "Prices are in QAR and come from us, never from the model.",
      "Do not mention CAD software to the client; show only how the product will look.",
      `Case label: at most ${BUILD_LIMITS.lookLabel} characters; we print the first 16 and tell you if we cut it.`,
    ],
    build_file: { json_schema: buildFileJsonSchema(), example: EXAMPLE_BUILD_FILE },
  };
}

/** The same rules as compact markdown (MCP resource gestaltung://design-rules). */
export function designRulesText(rules: DesignRules): string {
  const lines: string[] = [];
  lines.push("# Gestaltung360 design rules", "");
  lines.push("## Rules", ...rules.rules.map((r) => `- ${r}`), "");
  lines.push("## Parts (library ids)", "", "| id | name | category | voltage | logic | mA | pins | in store |", "|---|---|---|---|---|---|---|---|");
  for (const p of rules.parts) {
    lines.push(`| ${p.id} | ${p.name} | ${p.category} | ${p.voltage} | ${p.logic_v} V | ${p.current_ma} | ${p.pins_summary} | ${p.sold_in_store ? "yes" : "we source"} |`);
  }
  const e = rules.enclosure;
  lines.push("", "## Enclosure", `- templates: ${e.templates.join(", ")}`, `- colours: ${e.colours.join(", ")}`, `- finishes: ${e.finishes.join(", ")}`, `- label: up to ${e.label_max} characters`);
  const m = rules.making;
  lines.push(
    "",
    "## Making",
    `- printer: ${m.printer}, build volume ${m.build_volume_mm.join(" x ")} mm`,
    `- minimum wall: ${m.min_wall_mm} mm`,
    `- processes: ${m.processes.join(", ")}`,
    `- ${m.method_note}`,
  );
  lines.push("", "## Build file", "Send this JSON shape (unknown keys are dropped). Example:", "", "```json", JSON.stringify(rules.build_file.example, null, 2), "```", "");
  return lines.join("\n");
}

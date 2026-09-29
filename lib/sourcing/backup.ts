// Backups for Voltaat products that are out of stock (owner, 2026-09-29: "do
// not show them, replace them with possible DigiKey and Mouser backups").
//
// Only the SAME product is a backup. A first run showed how easily that goes
// wrong: DigiKey sells the bare DRV8833 chip, Voltaat sells a DRV8833 module;
// short codes ("0402", "X5R") matched unrelated parts. So:
//   * ready-made modules, boards, kits, cables, holders… get no backup — DigiKey
//     and Mouser sell components, not the same hobby module;
//   * the model code must be specific (5+ characters, letters and digits) and
//     must be the start of the supplier's manufacturer part number.
// Anything else stays hidden until Voltaat restocks — never a lookalike.

import type { SupplierProduct } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Voltaat names with these words are assemblies, not a single component.
const ASSEMBLY =
  /\b(module|modules|board|kit|kits|shield|breakout|expansion|holder|cable|cables|adapter|adaptor|case|enclosure|set|pack|bundle|robot|car|starter|dev|devkit|development|arduino|raspberry|pi|esp32|esp8266|nodemcu|wemos|display|screen|lcd|oled|printer|filament|nozzle|tool|kit|thruster|drone|camera|keypad|joystick|relay|charger|power bank|solar panel|motor driver|mount|mounting|bracket|accessory|accessories|iron|soldering|heat sink|heatsink|propeller|programmer|debugger|controller|clearance)\b/i;

const NOT_MODELS = new Set(["usb", "wifi", "rgb", "led", "lcd", "diy", "pcs", "i2c", "spi", "pwm", "x5r", "x7r", "c0g", "np0", "stm32", "rs485", "rs232", "to220", "to92", "to247", "sot23", "dip8", "dip14", "dip16", "soic8", "atmega", "esp32"]);
const STOP = new Set(["with", "and", "for", "the", "single", "dual", "input", "output", "high", "low", "digital", "analog", "channel", "chip", "type", "generic", "original", "sale", "clearance", "standard", "general", "purpose", "circuit"]);

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w))
  );

/** Both say what kind of part it is the same way (sensor/sensor, amplifier/amplifier). */
export function sameKind(voltaatName: string, p: Pick<SupplierProduct, "description" | "category" | "name">): boolean {
  const a = words(voltaatName);
  const b = words([p.description, p.category, p.name].filter(Boolean).join(" "));
  return [...a].some((w) => b.has(w));
}

/** Is this Voltaat product a single component a distributor would sell as-is? */
export function isComponent(name: string): boolean {
  return !ASSEMBLY.test(name);
}

/**
 * Specific model codes in a product name: 5+ characters with letters and
 * digits, not values, sizes or packages. Longest first.
 */
export function modelCodes(name: string): string[] {
  const tokens = name
    .replace(/[()[\],/+]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => squash(t).length >= 5 && /[a-z]/i.test(t) && /\d/.test(t))
    .filter((t) => !NOT_MODELS.has(squash(t)))
    .filter((t) => !/^\d+-?(inch|in|cm|mm|pin|way|port)s?$/i.test(t))
    // Values and sizes ("1000mAh", "220uF", "12V2A", "5x7cm"), not models.
    .filter((t) => !/^\d+(?:[.,]\d+)?(?:k|m|u|µ|n|p)?(?:v|a|ma|mah|w|mm|cm|uf|nf|pf|ohm|hz|khz|mhz|g|kg|rpm)(?:\d+(?:[.,]\d+)?(?:v|a|w))?$/i.test(t))
    .filter((t) => !/^\d+x\d+/i.test(t));
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

/** The supplier's part number starts with the code (DRV8833 → DRV8833PWPR). */
export function carriesModel(p: Pick<SupplierProduct, "mpn">, code: string): boolean {
  const c = squash(code);
  const mpn = squash(p.mpn ?? "");
  return c.length >= 5 && mpn.startsWith(c);
}

type Mount = "tht" | "smd" | "other" | null;

/**
 * How a part is mounted (owner, 2026-09-29: surface-mount and through-hole are
 * different items). Voltaat's hobby parts are through-hole unless the name
 * says otherwise.
 */
export function wantedMount(voltaatName: string): Mount {
  return /\b(smd|smt|surface[- ]mount|soic|sot-?\d+|qfn|tssop|ssop|msop|0402|0603|0805|1206)\b/i.test(voltaatName) ? "smd" : "tht";
}

export function resultMount(p: Pick<SupplierProduct, "parameters" | "description">): Mount {
  const param = p.parameters.find((x) => /mounting (type|style)/i.test(x.name))?.value ?? "";
  if (/surface|smd|smt/i.test(param)) return "smd";
  if (/through/i.test(param)) return "tht";
  if (param) return "other"; // chassis, panel, free-hanging…
  const d = p.description ?? "";
  if (/\b(soic|sot-?\d+|qfn|tssop|ssop|msop|dfn|0402|0603|0805)\b/i.test(d)) return "smd";
  if (/\b(dip|pdip|to-?92|to-?220|through hole)\b/i.test(d)) return "tht";
  return null;
}

/** A surface-mount result never backs a through-hole item, and the other way round. */
export function sameMount(voltaatName: string, p: Pick<SupplierProduct, "parameters" | "description">): boolean {
  const want = wantedMount(voltaatName);
  const got = resultMount(p);
  return !(got === "smd" && want === "tht") && !(got === "tht" && want === "smd");
}

/** The first result that is the same model, kind of part and mounting, and has a price. */
export function pickBackup(results: SupplierProduct[], code: string, voltaatName?: string): SupplierProduct | null {
  return (
    results.find(
      (r) =>
        r.cost !== null &&
        r.cost > 0 &&
        carriesModel(r, code) &&
        (voltaatName === undefined || (sameKind(voltaatName, r) && sameMount(voltaatName, r)))
    ) ?? null
  );
}

/** Our store name for a backup: the supplier's description with its maker and part number. */
export function backupName(p: SupplierProduct): string {
  const desc = (p.description ?? p.name).replace(/\s+/g, " ").trim();
  const id = [p.manufacturer, p.mpn].filter(Boolean).join(" ");
  const name = id && !desc.toLowerCase().includes((p.mpn ?? "").toLowerCase()) ? `${desc} (${id})` : desc;
  return name.slice(0, 160);
}

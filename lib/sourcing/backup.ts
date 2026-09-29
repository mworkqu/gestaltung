// Backups for Voltaat products that are out of stock (owner, 2026-09-29: "do
// not show them, replace them with possible DigiKey and Mouser backups").
//
// Only an exact model is a backup. We read the model codes in the Voltaat name
// ("HC-SR04", "ESP32-S3", "SG90", "DRV8833") and accept a supplier result only
// when its manufacturer part number or description carries the same code. A
// product with no model code in its name ("Underwater Thruster") gets no
// backup and stays hidden until Voltaat restocks — never a lookalike.

import type { SupplierProduct } from "./types";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Words that look like codes but aren't models.
const NOT_MODELS = new Set(["usb", "usb2", "usb3", "wifi", "5v", "3v3", "12v", "24v", "rgb", "led", "lcd", "diy", "pcs", "mm", "cm", "v2", "v3", "v4", "ic", "i2c", "spi", "pwm"]);

/**
 * Model codes in a product name: tokens with both letters and digits, 3+
 * characters, not units or plain words. Longest first (most specific).
 */
export function modelCodes(name: string): string[] {
  const tokens = name
    .replace(/[()[\],/+]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => t.length >= 3 && /[a-z]/i.test(t) && /\d/.test(t))
    .filter((t) => !NOT_MODELS.has(t.toLowerCase()))
    // "10k", "220uF", "12V", "5mm", "1000mAh": values, not models.
    .filter((t) => !/^\d+(?:[.,]\d+)?(?:k|m|u|µ|n|p)?(?:v|a|ma|mah|w|mm|cm|uf|nf|pf|ohm|hz|khz|mhz|g|kg)?$/i.test(t));
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

/** Does this supplier result carry the model code? */
export function carriesModel(p: Pick<SupplierProduct, "mpn" | "description" | "name">, code: string): boolean {
  const c = squash(code);
  if (c.length < 3) return false;
  return [p.mpn, p.name, p.description].some((s) => !!s && squash(s).includes(c));
}

/** The first result that is the same model and has a price, or null. */
export function pickBackup(results: SupplierProduct[], code: string): SupplierProduct | null {
  return results.find((r) => r.cost !== null && r.cost > 0 && carriesModel(r, code)) ?? null;
}

/** Our store name for a backup: the supplier's description with its maker and part number. */
export function backupName(p: SupplierProduct): string {
  const desc = (p.description ?? p.name).replace(/\s+/g, " ").trim();
  const id = [p.manufacturer, p.mpn].filter(Boolean).join(" ");
  const name = id && !desc.toLowerCase().includes((p.mpn ?? "").toLowerCase()) ? `${desc} (${id})` : desc;
  return name.slice(0, 160);
}

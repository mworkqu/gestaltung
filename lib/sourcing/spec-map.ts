// Supplier parameters → our typed attributes (Task 19b feeding Task 14).
// DigiKey (and a little of Mouser) describe parts as name/value text pairs
// ("Voltage - DC Reverse (Vr) (Max)" = "100 V"). This picks our attribute
// class from the category and description, then reads only the fields that
// class defines. Anything it can't read confidently is left out — a missing
// attribute is honest, a wrong one mis-matches a customer's BOM.

import { cleanAttributes, type Attributes } from "@/lib/store/attributes";

type Param = { name: string; value: string };

const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/** First number with an SI prefix before the given unit: "200mA" → 0.2 (unit A), "10 kOhms" → 10000. */
export function siValue(text: string, unit: RegExp): number | null {
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([pnuµμmkKMG]?)\\s*(?:${unit.source})`, "i");
  const m = re.exec(text.replace(/,/g, ""));
  if (!m) return null;
  // "m" before "Ω"/"Ohm" is milli; "M" is mega — keep the case the text used.
  const prefix = m[2];
  const mult = SI[prefix] ?? SI[prefix.toLowerCase()] ?? 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? Number(n.toPrecision(6)) : null;
}

export function detectClass(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bled\b|light emitting/.test(t)) return "led";
  if (/resistor/.test(t) && !/thermistor|varistor|potentiometer/.test(t)) return "resistor";
  if (/capacitor/.test(t)) return "capacitor";
  if (/diode|rectifier|zener|schottky/.test(t)) return "diode";
  if (/transistor|mosfet|\bbjt\b|\bfet\b/.test(t)) return "transistor";
  if (/switch/.test(t) && !/regulator|ic\b/.test(t)) return "switch";
  if (/header|terminal block|connector/.test(t)) return "header";
  return null;
}

const find = (params: Param[], re: RegExp) => params.find((p) => re.test(p.name))?.value ?? null;

function mounting(params: Param[]): string | undefined {
  const m = find(params, /^Mounting Type/i);
  if (!m) return undefined;
  if (/through hole/i.test(m)) return "through_hole";
  if (/surface mount|smd/i.test(m)) return "smd";
  return undefined;
}

export function parametersToAttributes(params: Param[], context: { category?: string | null; description?: string | null }): Attributes {
  const text = [context.category, context.description].filter(Boolean).join(" ");
  const cls = detectClass(text);
  if (!cls) return {};
  const a: Attributes = { class: cls };
  const set = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") a[k] = v;
  };

  switch (cls) {
    case "resistor":
      set("resistance_ohm", siValue(find(params, /^Resistance/i) ?? "", /Ω|ohm/));
      set("tolerance_pct", siValue(find(params, /^Tolerance/i) ?? "", /%/));
      set("power_w", siValue(find(params, /^Power/i) ?? "", /W/));
      set("package", mounting(params));
      break;
    case "capacitor": {
      set("capacitance_f", siValue(find(params, /^Capacitance/i) ?? "", /F/));
      set("voltage_v", siValue(find(params, /^Voltage - Rated/i) ?? "", /V/));
      const d = text.toLowerCase();
      set("dielectric", /ceramic/.test(d) ? "ceramic" : /electrolytic/.test(d) ? "electrolytic" : /tantalum/.test(d) ? "tantalum" : /film/.test(d) ? "film" : undefined);
      set("package", mounting(params));
      break;
    }
    case "diode": {
      const t = [text, ...params.filter((p) => /^(Diode Type|Speed|Technology)/i.test(p.name)).map((p) => p.value)].join(" ").toLowerCase();
      set("diode_type", /zener/.test(t) ? "zener" : /schottky/.test(t) ? "schottky" : /small signal|switching/.test(t) ? "signal" : /rectifier|standard/.test(t) ? "rectifier" : undefined);
      set("voltage_v", siValue(find(params, /^Voltage - (DC Reverse|Zener|Reverse)/i) ?? "", /V/));
      set("current_a", siValue(find(params, /^Current - (Average Rectified|Max)/i) ?? "", /A/));
      set("package", mounting(params));
      break;
    }
    case "transistor": {
      const ty = `${find(params, /^(Transistor Type|FET Type)/i) ?? ""}`.toLowerCase();
      set("transistor_type", /n-channel/.test(ty) ? "n_mosfet" : /p-channel/.test(ty) ? "p_mosfet" : /\bnpn\b/.test(ty) ? "npn" : /\bpnp\b/.test(ty) ? "pnp" : undefined);
      set("current_a", siValue(find(params, /^Current - (Collector|Continuous Drain)/i) ?? "", /A/));
      set("voltage_v", siValue(find(params, /^(Voltage - Collector Emitter Breakdown|Drain to Source Voltage)/i) ?? "", /V/));
      const pkg = `${find(params, /^(Supplier Device Package|Package \/ Case)/i) ?? ""}`.toUpperCase();
      set("package", /TO-92/.test(pkg) ? "to92" : /TO-220/.test(pkg) ? "to220" : /SOT-23/.test(pkg) ? "sot23" : pkg ? "other" : undefined);
      break;
    }
    case "led": {
      const c = `${find(params, /^Color/i) ?? ""}`.toLowerCase();
      set("color", /rgb/.test(c) ? "rgb" : /red/.test(c) ? "red" : /green/.test(c) ? "green" : /blue/.test(c) ? "blue" : /yellow|amber/.test(c) ? "yellow" : /white/.test(c) ? "white" : c ? "other" : undefined);
      set("size_mm", siValue(`${find(params, /^(Size \/ Dimension|Lens Size)/i) ?? ""} ${text}`, /mm/) );
      set("package", mounting(params));
      break;
    }
    case "switch": {
      const t = text.toLowerCase();
      set("switch_type", /tactile/.test(t) ? "tactile" : /toggle/.test(t) ? "toggle" : /slide/.test(t) ? "slide" : /rocker/.test(t) ? "rocker" : /limit/.test(t) ? "limit" : /reed/.test(t) ? "reed" : undefined);
      set("package", mounting(params));
      break;
    }
    case "header": {
      const t = text.toLowerCase();
      set("connector_type", /terminal block|screw/.test(t) ? "screw_terminal" : /jst/.test(t) ? "jst" : /female|receptacle|socket/.test(t) ? "female_header" : /header/.test(t) ? "pin_header" : undefined);
      set("pins", Number(find(params, /^Number of Positions/i)?.match(/\d+/)?.[0]) || undefined);
      set("pitch_mm", siValue(find(params, /^Pitch/i) ?? "", /mm/));
      break;
    }
  }
  return cleanAttributes(a);
}

/** Fill only the fields the product doesn't have yet; never overwrite. */
export function fillMissing(current: Attributes | null | undefined, sourced: Attributes): Attributes {
  const cur = current ?? {};
  if (cur.class && sourced.class && cur.class !== sourced.class) return cur;
  const out: Attributes = { ...cur };
  for (const [k, v] of Object.entries(sourced)) {
    if (out[k] === undefined || out[k] === null || out[k] === "") out[k] = v;
  }
  return out;
}

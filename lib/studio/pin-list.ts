// Pin list + build guide wording (P5-17). Pure: Connection[] in, plain rows out.
// The Pin list tab, its Copy text and the "Wire it step by step" line all read
// from here so they say the same thing.

import { partName, WIRE_NAME, type Connection, type WireColour } from "./connections";
import { connectionKey } from "./connections";
import { isMcu, type GetPart, type Locale } from "./netlist";

export type PinListRow = {
  id: string;
  /** Stable key (ticks are saved by it). */
  key: string;
  /** "ESP32 brain board GPIO4": the board end, else the from end. */
  boardPin: string;
  /** Just the pin label on that end ("GPIO4"). */
  boardPinLabel: string;
  toPart: string;
  partPin: string;
  colour: WireColour;
  colourName: string;
  note: string;
  net: string;
};

const T = {
  ground: { en: "Ground. Use the black wire for every ground.", ar: "أرضي. استخدم السلك الأسود لكل توصيلات الأرضي." },
  power: { en: "Power. Use the red wire for every power line.", ar: "طاقة. استخدم السلك الأحمر لكل خطوط الطاقة." },
  via: { en: "Through the {name}", ar: "عبر {name}" },
  head: {
    en: ["Done", "Board pin", "Goes to", "Part pin", "Wire colour", "Note"],
    ar: ["تم", "طرف اللوحة", "يتصل بـ", "طرف القطعة", "لون السلك", "ملاحظة"],
  },
  step: {
    en: "Wire {i} of {n}: {colour} from {from} to {to}",
    ar: "السلك {i} من {n}: {colour} من {from} إلى {to}",
  },
  stepVia: {
    en: "Wire {i} of {n}: {colour} from {from} to {to}, through the {via}",
    ar: "السلك {i} من {n}: {colour} من {from} إلى {to}، عبر {via}",
  },
} as const;

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** One row per connection, same order (ground, power, signals). */
export function pinListRows(connections: Connection[], getPart: GetPart, locale: Locale): PinListRow[] {
  return connections.map((c) => {
    const fromIsBoard = !!getPart(c.from.partId) && isMcu(getPart(c.from.partId)!);
    const toIsBoard = !!getPart(c.to.partId) && isMcu(getPart(c.to.partId)!);
    // Board side first; with no board at either end keep from → to.
    const swap = !fromIsBoard && toIsBoard;
    const a = swap ? c.to : c.from;
    const b = swap ? c.from : c.to;
    const nameOf = (e: Connection["from"]) => partName(getPart(e.partId), locale, e.part);
    let note = "";
    if (c.viaPartId || c.viaPart) {
      note = fill(T.via[locale], { name: partName(getPart(c.viaPartId ?? ""), locale, c.viaPart ?? "") });
    } else if (c.role === "ground") note = T.ground[locale];
    else if (c.role === "power") note = T.power[locale];
    return {
      id: c.id,
      key: connectionKey(c),
      boardPin: `${nameOf(a)} ${a.label}`,
      boardPinLabel: a.label,
      toPart: nameOf(b),
      partPin: b.label,
      colour: c.wireColour,
      colourName: WIRE_NAME[c.wireColour][locale],
      note,
      net: c.net,
    };
  });
}

/** Tab-separated text for Copy: a header line, then one line per row. */
export function pinListText(rows: PinListRow[], locale: Locale = "en", ticked?: ReadonlySet<string>): string {
  const h = T.head[locale];
  const lines = [[h[1], h[2], h[3], h[4], h[5]].join("\t")];
  for (const r of rows) {
    const done = ticked?.has(r.key) ? "[x] " : "";
    lines.push([`${done}${r.boardPin}`, r.toPart, r.partPin, r.colourName, r.note].join("\t"));
  }
  return lines.join("\n");
}

/** "Wire 3 of 8: yellow from D2 to LED +". i is 0-based. */
export function guideLine(c: Connection, i: number, n: number, getPart: GetPart, locale: Locale): string {
  const nameOf = (e: Connection["from"]) => `${partName(getPart(e.partId), locale, e.part)} ${e.label}`;
  const via = c.viaPartId || c.viaPart ? partName(getPart(c.viaPartId ?? ""), locale, c.viaPart ?? "") : "";
  return fill(via ? T.stepVia[locale] : T.step[locale], {
    i: String(i + 1),
    n: String(n),
    colour: WIRE_NAME[c.wireColour][locale],
    from: nameOf(c.from),
    to: nameOf(c.to),
    via,
  });
}

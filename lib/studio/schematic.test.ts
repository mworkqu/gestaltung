import { describe, expect, it } from "vitest";
import { esc } from "@/lib/prototyping/netlist";
import { BUTTON, LED, MINI_MCU, RESISTOR, SONAR, SHIFTER, comps, lib, part } from "./__fixtures__/parts";
import { getPart } from "./library";
import { buildWiring, type GetPart, type Locale } from "./netlist";
import { plainName } from "./plain-checks";
import { renderSchematicSVG, summaryLine } from "./schematic";
import { DEFAULT_SPEC, type ProductSpec, type StudioComponent } from "./schema";

/** Balanced tags, one root <svg>, no stray "<" in text. */
function wellFormed(svg: string) {
  expect(svg.startsWith("<svg ")).toBe(true);
  expect(svg.endsWith("</svg>")).toBe(true);
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    expect(svg.slice(last, m.index)).not.toMatch(/[<>]/);
    last = re.lastIndex;
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(svg.slice(last)).toBe("");
  expect(stack).toEqual([]);
}

function render(ids: string[], spec: ProductSpec, get: GetPart, locale: Locale, title?: string) {
  const w = buildWiring(comps(...ids), spec, get, locale);
  return { w, svg: renderSchematicSVG(w.components, w.netlist.nets, get, { locale, title }) };
}

function containsEverything(svg: string, components: StudioComponent[], nets: { name: string }[], get: GetPart, locale: Locale) {
  for (const c of components) expect(svg).toContain(esc(plainName(get(c.partId)!, locale)));
  for (const n of nets) expect(svg).toContain(`data-net="${esc(n.name)}"`);
}

const ESP_SET = ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "button_6mm", "led_5mm"];

describe("renderSchematicSVG", () => {
  it("keeps every label legible: no text under 10 units, pin / part labels 11+, boxes still fit their labels", () => {
    for (const locale of ["en", "ar"] as const) {
      const { svg } = render(ESP_SET, DEFAULT_SPEC, getPart, locale, "Motion lamp");
      const sizes = [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(10);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
      // Pin names (the mono 11 labels) are the most numerous text.
      expect(sizes.filter((v) => v >= 11).length).toBeGreaterThan(sizes.filter((v) => v < 11).length);
      // A box is never narrower than its title text.
      for (const m of svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="[\d.]+" rx="10"/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(128);
      }
    }
  });

  it("is deterministic", () => {
    const a = render(ESP_SET, DEFAULT_SPEC, getPart, "en", "Motion lamp").svg;
    const b = render(ESP_SET, DEFAULT_SPEC, getPart, "en", "Motion lamp").svg;
    expect(a).toBe(b);
  });

  for (const locale of ["en", "ar"] as const) {
    it(`draws the ESP32 set (${locale}): well-formed, every part and net, labels for rails`, () => {
      const { w, svg } = render(ESP_SET, DEFAULT_SPEC, getPart, locale, "Motion lamp");
      wellFormed(svg);
      containsEverything(svg, w.components, w.netlist.nets, getPart, locale);
      // Rails are labels / symbols, signals have their names on the wire or a flag.
      expect(svg).toMatch(/>3V3<\/text>/);
      expect(svg).toMatch(/>5V<\/text>/);
      for (const n of ["PIR_OUT", "SDA", "SCL", "BTN1", "LED1"]) expect(svg).toContain(`>${n}</text>`);
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg).not.toMatch(/@import|url\(|https?:\/\/(?!www\.w3\.org)/);
      // Inline helper symbols: resistor zigzag and LED triangle.
      expect(svg).toContain("<polyline");
      expect(svg).toContain("<polygon");
    });
  }

  it("is deterministic", () => {
    const a = render(ESP_SET, DEFAULT_SPEC, getPart, "en").svg;
    const b = render(ESP_SET, DEFAULT_SPEC, getPart, "en").svg;
    expect(a).toBe(b);
  });

  it("draws the battery chain, the Uno and an Arabic title", () => {
    const spec: ProductSpec = { ...DEFAULT_SPEC, power: "battery_usb" };
    const bat = render(["esp32_devkit", "cell_18650", "tp4056_usbc", "oled_096_i2c"], spec, getPart, "ar", "مصباح");
    wellFormed(bat.svg);
    containsEverything(bat.svg, bat.w.components, bat.w.netlist.nets, getPart, "ar");
    expect(bat.svg).toContain(`direction="rtl"`);
    expect(bat.svg).toContain(">VBAT</text>");
    const uno = render(["arduino_uno", "pir_hcsr501", "oled_096_i2c", "button_6mm", "led_5mm", "dht22"], DEFAULT_SPEC, getPart, "en");
    wellFormed(uno.svg);
    containsEverything(uno.svg, uno.w.components, uno.w.netlist.nets, getPart, "en");
  });

  it("handles fixtures: shifters, no-connects, many buttons, no board", () => {
    const get = lib(MINI_MCU, SONAR, SHIFTER, BUTTON, LED, RESISTOR);
    const a = render(["mini_mcu", "sonar_5v", "btn_tact", "btn_tact", "btn_tact", "btn_tact", "btn_tact", "led_red"], DEFAULT_SPEC, get, "en");
    wellFormed(a.svg);
    containsEverything(a.svg, a.w.components, a.w.netlist.nets, get, "en");
    const noBoard = render(["btn_tact", "sonar_5v"], DEFAULT_SPEC, get, "en");
    wellFormed(noBoard.svg);
  });

  it("escapes text", () => {
    const evil = part("evil_part", "sensor", [["VCC", "vin"], ["OUT", "out"], ["GND", "gnd"]], { name: `A<b>&"c"` });
    const get = lib(MINI_MCU, evil);
    const { svg } = render(["mini_mcu", "evil_part"], DEFAULT_SPEC, get, "en", `<script>alert(1)</script>`);
    wellFormed(svg);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("A&lt;b&gt;&amp;&quot;c&quot;");
  });
});

describe("summaryLine", () => {
  it("names the board, the power and where it lives", () => {
    const c = comps("esp32_devkit", "pir_hcsr501");
    expect(summaryLine({ ...DEFAULT_SPEC, power: "battery" }, c, getPart, "en")).toBe("ESP32 · battery powered · indoors");
    expect(summaryLine({ ...DEFAULT_SPEC, power: "usb", environment: "outdoor" }, comps("arduino_uno"), getPart, "en")).toBe(
      "Arduino Uno · USB powered · outdoors",
    );
    expect(summaryLine({ ...DEFAULT_SPEC, power: "battery" }, c, getPart, "ar")).toBe("ESP32 · يعمل بالبطارية · داخلي");
    expect(summaryLine(DEFAULT_SPEC, [], getPart, "en")).toBe("USB powered · indoors");
  });
});

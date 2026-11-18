import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforcePick } from "@/lib/studio/ai/pick";
import { initialStep } from "@/lib/studio/client/steps";
import { PIN_BLOCK_END, PIN_BLOCK_START } from "@/lib/studio/connections";
import { CODE_LIBRARY } from "@/lib/studio/library";
import { buildWiring } from "@/lib/studio/netlist";
import { GOLDEN_IDEAS, type GoldenIdea } from "@/lib/studio/product/__fixtures__/golden";
import { FLOW } from "@/lib/studio/client/steps";
import { BuildFileSchema, EXAMPLE_BUILD_FILE, type BuildFile, type BuildFileInput } from "./build-file";
import { buildToStudio, finalizeDoc, pluginIndex, pluginLibraryFrom } from "./to-studio";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const lib = pluginLibraryFrom(CODE_LIBRARY);
const getPart = CODE_LIBRARY.getPart;
const parse = (b: BuildFileInput): BuildFile => BuildFileSchema.parse(b);

/** A golden idea as a client's AI would send it: the same parts, repeats as qty. */
function goldenBuild(g: GoldenIdea): BuildFile {
  const parts: { library_id: string; qty: number }[] = [];
  for (const id of g.partIds) {
    const last = parts[parts.length - 1];
    if (last?.library_id === id) last.qty++;
    else parts.push({ library_id: id, qty: 1 });
  }
  const power = g.spec.power === "mains_adapter" ? "adapter" : g.spec.power === "usb" ? "usb" : "battery";
  return parse({
    version: 1,
    name: g.spec.name,
    summary: { what_it_does: g.spec.oneLine, where_used: g.spec.environment, power },
    parts,
    look: { template: g.key === "plant_waterer" ? "stake_pod" : "rounded_box", colour: "sage", finish: "matte_plastic" },
    cad: { prompt: "A small case." },
  });
}

const netStrings = (nets: { name: string; pins: string[] }[]) =>
  nets.map((n) => `${n.name}:${[...n.pins].sort().join(",")}`).sort();

describe("golden ideas through the plugin wire exactly like the website", () => {
  for (const g of GOLDEN_IDEAS) {
    it(g.key, () => {
      const build = goldenBuild(g);
      const r = buildToStudio(build, lib);
      expect(r.doc, r.problems.join("; ")).not.toBeNull();

      // The website path with the GOLDEN spec (as golden-regression.test.ts runs it). The one
      // difference: the index also holds the direct helpers this build names (the LED), because
      // a plugin client chose that LED itself while the website model never sees helpers. The
      // derived spec differs from the golden spec in words, sizes and how a servo is described
      // (spec.actuators instead of a "motor" output) — none of which changes parts or wiring.
      const picked = enforcePick(
        { components: g.partIds.map((partId) => ({ partId })) },
        {
          spec: g.spec,
          index: pluginIndex(build, lib),
          locale: "en",
          log: [],
          nameFor: (id) => getPart(id)?.name.en,
          pinsOf: (id) => getPart(id)?.pins,
          stockOf: (id) => (getPart(id)?.storeSkus.length ?? 0) > 0,
        },
      );
      const w = buildWiring(picked.components, g.spec, getPart, "en");
      const doc = r.doc!;
      expect(doc.components.map((c) => c.instanceId).sort()).toEqual(w.components.map((c) => c.instanceId).sort());
      expect(netStrings(doc.netlist.nets)).toEqual(netStrings(w.netlist.nets));
      expect(doc.checks.map((c) => `${c.id}:${c.ok}`)).toEqual(w.checks.map((c) => `${c.id}:${c.ok}`));
    });
  }
});

describe("buildToStudio", () => {
  const example = parse(EXAMPLE_BUILD_FILE);

  it("maps the example to a valid doc that opens on Enclosure", () => {
    const r = buildToStudio(example, lib, { now: new Date("2026-11-18T10:00:00Z") });
    expect(r.problems).toEqual([]);
    expect(r.doc).not.toBeNull();
    const doc = r.doc!;
    expect(initialStep(doc, "enclosure")).toBe(FLOW.indexOf("enclosure"));
    expect(doc.lastStep).toBe("enclosure");
    expect(doc.enclosure?.template).toBe("stake_pod");
    expect(doc.enclosure?.colour).toBe("sage");
    expect(doc.spec.power).toBe("usb");
    expect(doc.spec.environment).toBe("outdoor");
    expect(doc.spec.outputs.sort()).toEqual(["led", "pump"]);
    // A pump that only switches on/off: our rule swaps the H-bridge for the MOSFET switch.
    expect(r.removed).toContain("motor_driver");
    expect(r.added).toContain("mosfet_module");
    expect(r.warnings.some((w) => /MOSFET/.test(w))).toBe(true);
  });

  it("stores the client's quotes, never the cad brief", () => {
    const build = parse({
      ...EXAMPLE_BUILD_FILE,
      requirement_quotes: ["it has to survive the balcony sun", "quiet at night"],
      cad: { prompt: "SECRET-CAD-BRIEF 90 x 60 mm", openscad: "cube([SECRET_SCAD,1,1]);" },
      wiring_notes: "SECRET-WIRING-NOTE",
    });
    const doc = buildToStudio(build, lib).doc!;
    expect(doc.answers?.plugin_quotes).toBe("it has to survive the balcony sun\nquiet at night");
    const json = JSON.stringify(doc);
    expect(json).not.toContain("SECRET-CAD-BRIEF");
    expect(json).not.toContain("SECRET_SCAD");
    expect(json).not.toContain("SECRET-WIRING-NOTE");
  });

  it("an unknown part id is a problem and no doc", () => {
    const build = parse({ ...EXAMPLE_BUILD_FILE, parts: [...EXAMPLE_BUILD_FILE.parts, { library_id: "flux_capacitor" }] });
    const r = buildToStudio(build, lib);
    expect(r.doc).toBeNull();
    expect(r.problems.some((p) => p.includes("'flux_capacitor' is not in our library"))).toBe(true);
  });

  it("a helper only our wiring adds is refused; the LED is accepted with its count", () => {
    const bad = buildToStudio(parse({ ...EXAMPLE_BUILD_FILE, parts: [...EXAMPLE_BUILD_FILE.parts, { library_id: "resistor_220" }] }), lib);
    expect(bad.doc).toBeNull();
    const ok = buildToStudio(
      parse({ ...EXAMPLE_BUILD_FILE, parts: [{ library_id: "esp32_c3_mini" }, { library_id: "led_5mm", qty: 3 }] }),
      lib,
    );
    expect(ok.doc?.components.filter((c) => c.partId === "led_5mm" && !c.auto)).toHaveLength(3);
  });

  it("puts OUR pin block into the client's code and replaces a wrong pin", () => {
    const source = [
      "#include <Arduino.h>",
      PIN_BLOCK_START,
      "const int PUMP_PIN = 99;",
      PIN_BLOCK_END,
      "void setup() {}",
      "void loop() {}",
    ].join("\n");
    const build = parse({ ...EXAMPLE_BUILD_FILE, code: { language: "arduino", board: "esp32_c3_mini", source } });
    const r = buildToStudio(build, lib);
    const fw = r.doc!.firmware!;
    expect(fw.code).toContain(PIN_BLOCK_START);
    expect(fw.code).not.toContain("= 99;");
    expect(fw.code).toMatch(/const int \w+ = \d+;/);
    expect(fw.code).toContain("void loop() {}");
    expect(fw.board).toMatch(/ESP32/);
  });

  it("code for a board that is not in parts is a problem", () => {
    const build = parse({ ...EXAMPLE_BUILD_FILE, code: { language: "arduino", board: "arduino_uno", source: "void setup(){}" } });
    const r = buildToStudio(build, lib);
    expect(r.doc).toBeNull();
    expect(r.problems[0]).toMatch(/code\.board/);
  });

  it("solar is planned as battery with a warning; a long label is cut", () => {
    const build = parse({
      ...EXAMPLE_BUILD_FILE,
      summary: { ...EXAMPLE_BUILD_FILE.summary, power: "solar" },
      look: { ...EXAMPLE_BUILD_FILE.look, label: "Balcony garden helper" },
    });
    const r = buildToStudio(build, lib);
    expect(r.doc?.spec.power).toMatch(/^battery/);
    expect(r.warnings.some((w) => w.startsWith("Solar charging"))).toBe(true);
    expect(r.doc!.enclosure!.label!.length).toBeLessThanOrEqual(16);
    expect(r.warnings.some((w) => w.includes("case label"))).toBe(true);
  });

  it("two controllers become one, reported as removed", () => {
    const build = parse({ ...EXAMPLE_BUILD_FILE, parts: [{ library_id: "esp32_c3_mini" }, { library_id: "arduino_uno" }, { library_id: "button_6mm" }] });
    const r = buildToStudio(build, lib);
    expect(r.removed).toEqual(["arduino_uno"]);
    expect(r.doc!.components.filter((c) => getPart(c.partId)?.category === "mcu")).toHaveLength(1);
  });

  it("a doc the Studio schema refuses becomes problems, never a doc", () => {
    const good = buildToStudio(parse(EXAMPLE_BUILD_FILE), lib).doc!;
    const r = finalizeDoc({ ...good, lastStep: "x".repeat(40), components: [{ partId: 1 }] });
    expect(r.doc).toBeNull();
    expect(r.problems.some((p) => p.startsWith("Internal mapping error at lastStep"))).toBe(true);
    const big = finalizeDoc({ ...good, firmware: { board: "ESP32", code: "x".repeat(300 * 1024) } });
    expect(big.doc).toBeNull();
    expect(big.problems[0]).toMatch(/over our 256 kB limit/);
  });

  it("every doc it returns passes the Studio schema (parseStudioDoc path)", async () => {
    const { parseStudioDoc } = await import("@/lib/studio/schema");
    for (const g of GOLDEN_IDEAS) expect(parseStudioDoc(buildToStudio(goldenBuild(g), lib).doc)).not.toBeNull();
  });
});

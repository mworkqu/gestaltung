import { describe, expect, it } from "vitest";

import { isCompatible } from "./constants";
import { breakDown, suggestSpec, templateAppliesTo } from "./engine";

const PLANT_BRIEF =
  "A plant monitor: an ESP32 reads soil moisture and a DHT11, and runs a small pump to water the pot. " +
  "It sits on a desk in a small 3D-printed case. Powered from a USB adapter.";

describe("suggestSpec: explicit words win (audit #5)", () => {
  it("a 3D-printed case in the brief decides the Enclosure shell: PLA, 3D printing", () => {
    const s = suggestSpec("Enclosure shell", "small 3D-printed case");
    expect(s).toMatchObject({ material: "pla", process: "3d_printing", reasonKey: "brief" });
  });

  it("the Plant monitor brief gives its enclosure PLA + 3D printing, not stainless + laser", () => {
    expect(suggestSpec("Enclosure shell Holds the ESP32 and sensors", PLANT_BRIEF)).toMatchObject({
      material: "pla",
      process: "3d_printing",
    });
  });

  it("a printed part in heat or outdoors is PETG", () => {
    expect(suggestSpec("Enclosure shell", "3D printed case for the garden").material).toBe("petg");
    expect(suggestSpec("Enclosure shell", "a PETG printed housing").material).toBe("petg");
  });

  it("an aluminium enclosure stays aluminium with a process that can cut it", () => {
    const s = suggestSpec("aluminium enclosure");
    expect(s.material).toBe("aluminium_6061");
    expect(["laser_cutting", "cnc_machining"]).toContain(s.process);
    expect(s.reasonKey).toBe("stated");
  });

  it("a laser-cut acrylic panel is acrylic on the laser", () => {
    expect(suggestSpec("laser-cut acrylic panel")).toMatchObject({ material: "acrylic", process: "laser_cutting" });
  });

  it("words in the part's own text beat the brief's", () => {
    expect(suggestSpec("Enclosure shell, CNC machined aluminium", "small 3D-printed case")).toMatchObject({
      material: "aluminium_6061",
      process: "cnc_machining",
    });
    // A part-level process beats a brief-level material it can't work.
    expect(suggestSpec("3D printed enclosure", "an aluminium product")).toMatchObject({
      material: "pla",
      process: "3d_printing",
    });
  });

  it("brief words only reach enclosure-like parts", () => {
    expect(suggestSpec("Drive coupling", "small 3D-printed case").process).toBe("edm");
  });

  it("a printed circuit board and a machine are not processes", () => {
    const s = suggestSpec("Enclosure shell", "a machine on a printed circuit board in a box");
    expect(s).toMatchObject({ material: "stainless_304", process: "laser_cutting", reasonKey: "sheet" });
  });

  it("a case for a board is still a case, not a PCB", () => {
    expect(suggestSpec("Controller board housing").process).not.toBe("pcb_manufacturing");
    expect(suggestSpec("Sensor board").process).toBe("pcb_manufacturing");
  });

  it("always returns a makeable pair", () => {
    const texts = ["3D printed brass case", "laser cut PLA lid", "EDM acrylic key", "sheet metal box", "cnc petg bracket"];
    for (const x of texts) {
      const s = suggestSpec(x, "3d printed aluminium laser cut");
      expect(isCompatible(s.material, s.process)).toBe(true);
    }
  });

  it("with no stated words, the shape guess is unchanged", () => {
    expect(suggestSpec("Enclosure shell")).toMatchObject({ material: "stainless_304", process: "laser_cutting" });
    expect(suggestSpec("Drive coupling")).toMatchObject({ material: "stainless_304", process: "edm" });
  });
});

describe("part templates: no leaks (audit #5)", () => {
  it("never attaches reservoir text to a part whose name isn't a reservoir", () => {
    expect(templateAppliesTo("reservoir", "Plant pot mount")).toBe(false);
    expect(templateAppliesTo("reservoir", "Reservoir / bowl housing")).toBe(true);
    expect(templateAppliesTo("reservoir", "مبيت الخزان / الوعاء")).toBe(true);
    expect(templateAppliesTo("dispenser", "مبيت التوزيع")).toBe(true);
    expect(templateAppliesTo("nope", "Anything")).toBe(false);
  });

  it("water or a pump alone does not add a reservoir, a dispenser or a drive coupling", () => {
    const keys = breakDown(PLANT_BRIEF).map((p) => p.key);
    expect(keys).not.toContain("reservoir");
    expect(keys).not.toContain("coupling");
    expect(keys).not.toContain("dispenser");
    expect(keys).toContain("enclosure");
  });

  it("a brief that names a hopper and a bowl still gets those parts", () => {
    expect(breakDown("A cat feeder with a kibble hopper and a water bowl").map((p) => p.key)).toEqual(
      expect.arrayContaining(["dispenser", "reservoir"])
    );
  });
});

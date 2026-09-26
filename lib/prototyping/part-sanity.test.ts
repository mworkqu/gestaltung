// Brief fidelity: plausible dimensions and enclosure fit (audit #5).

import { describe, expect, it } from "vitest";

import { KEEPABLE_NEEDS, enclosureMisfit, implausibleDims, partNeeds, type PartLike } from "./parts";
import { boardsIn, footprintOf, projectBoards } from "./footprints";

const mech = (over: Partial<PartLike>): PartLike => ({
  id: "e",
  code: "P-01",
  name: "Enclosure shell",
  source: "to_design",
  kind: "mechanical",
  status: "confirmed",
  material: "pla",
  process: "3d_printing",
  shape: "block",
  length_mm: 80,
  width_mm: 50,
  height_mm: 30,
  ...over,
});
const esp32 = boardsIn(["ESP32 Dev Board"]);

describe("footprints", () => {
  it("recognises boards by name, most specific first", () => {
    expect(footprintOf("ESP32 DevKit V1")?.id).toBe("esp32_devkit");
    expect(footprintOf("ESP32-CAM camera board")).toMatchObject({ id: "esp32_cam", length_mm: 40, width_mm: 27 });
    expect(footprintOf("ESP32 CAM")?.id).toBe("esp32_cam");
    expect(footprintOf("ESP32-C3 Super Mini")?.id).toBe("esp32_c3_mini");
    expect(footprintOf("Arduino Nano ESP32")?.id).toBe("arduino_nano");
    expect(footprintOf("Arduino Uno R3")?.id).toBe("arduino_uno");
    expect(footprintOf("Arduino Pro Mini 3.3V")?.id).toBe("arduino_pro_mini");
    expect(footprintOf("Raspberry Pi Zero 2 W")?.id).toBe("pi_zero");
    expect(footprintOf("Raspberry Pi Pico")?.id).toBe("pi_pico");
    expect(footprintOf("Raspberry Pi 4")?.id).toBe("raspberry_pi");
    expect(footprintOf("Breadboard 400 points")?.id).toBe("breadboard_400");
    expect(footprintOf("Mini breadboard 170")).toBeNull();
    expect(footprintOf("ESP32-WROOM-32 module")).toBeNull();
    expect(footprintOf("DHT11 sensor")).toBeNull();
  });

  it("reads a project's BOM, catalog parts and store lines, skipping removed lines", () => {
    const boards = projectBoards({
      bom: {
        lines: [
          { id: "mcu", function: "ESP32 dev board", kind: "electronics" },
          { id: "old", function: "Arduino Uno", kind: "electronics" },
          { id: "m3", function: "M3 screws", kind: "mechanical" },
        ],
        dismissed: ["old"],
      },
      partNames: ["Enclosure shell"],
      itemNames: ["Breadboard 400 tie-points"],
    });
    expect(boards.map((b) => b.id).sort()).toEqual(["breadboard_400", "esp32_devkit"]);
  });
});

describe("enclosure fit", () => {
  it("a 30 × 30 × 1 mm laser-cut stainless case is too small for an ESP32: not Ready", () => {
    const p = mech({
      material: "stainless_304",
      process: "laser_cutting",
      shape: null,
      length_mm: 30,
      width_mm: 30,
      thickness_mm: 1,
    });
    expect(partNeeds(p, { boards: esp32 })).toEqual(["tooSmall"]);
    expect(enclosureMisfit(p, esp32)).toEqual({ board: esp32[0], inner: [28, 28], needed: [56, 32] });
  });

  it("fits once big enough, and without a known board nothing is checked", () => {
    expect(partNeeds(mech({}), { boards: esp32 })).toEqual([]);
    const small = mech({ length_mm: 30, width_mm: 30, height_mm: 20 });
    expect(partNeeds(small, { boards: esp32 })).toEqual(["tooSmall"]);
    expect(partNeeds(small)).toEqual([]);
  });

  it("a block's wall thickness comes off the inside", () => {
    const walled = mech({ length_mm: 58, width_mm: 34, height_mm: 10, thickness_mm: 2 });
    expect(partNeeds(walled, { boards: esp32 })).toEqual(["tooSmall"]);
    expect(enclosureMisfit(walled, esp32)).toMatchObject({ inner: [54, 30], needed: [56, 32] });
    // Without the wall the same outside fits.
    expect(partNeeds({ ...walled, thickness_mm: null }, { boards: esp32 })).toEqual([]);
  });

  it("a block may hold the board on any face", () => {
    expect(enclosureMisfit(mech({ length_mm: 20, width_mm: 60, height_mm: 40 }), esp32)).toBeNull();
  });

  it("a round case must take the board's diagonal", () => {
    const disc = mech({ shape: "disc", diameter_mm: 60, thickness_mm: 2, length_mm: null, width_mm: null, height_mm: null });
    expect(enclosureMisfit(disc, esp32)?.needed[0]).toBeCloseTo(64.5, 1);
    expect(enclosureMisfit({ ...disc, diameter_mm: 70 }, esp32)).toBeNull();
  });

  it("the largest board decides", () => {
    const boards = boardsIn(["ESP32 dev board", "Breadboard"]);
    expect(enclosureMisfit(mech({ length_mm: 70, width_mm: 40, height_mm: 30 }), boards)?.board.id).toBe("breadboard_400");
  });

  it("only the main enclosure is checked, not a sensor housing, a lid or a mount", () => {
    const tiny = { length_mm: 20, width_mm: 15, height_mm: 10 };
    expect(enclosureMisfit(mech({ name: "Sensor housing", ...tiny }), esp32)).toBeNull();
    expect(enclosureMisfit(mech({ name: "Case lid", ...tiny }), esp32)).toBeNull();
    expect(enclosureMisfit(mech({ name: "Plant pot mount", ...tiny }), esp32)).toBeNull();
  });

  it("a wrong number blocks keeping a concept", () => {
    expect(KEEPABLE_NEEDS).not.toContain("tooSmall");
    expect(KEEPABLE_NEEDS).not.toContain("implausible");
  });
});

describe("Ready to make needs plausible, confirmed dimensions", () => {
  it("is ready only with every dimension set, plausible and confirmed", () => {
    expect(partNeeds(mech({}))).toEqual([]);
    expect(partNeeds(mech({ status: "suggested" }))).toEqual(["confirm"]);
    expect(partNeeds(mech({ height_mm: null }))).toEqual(["dimensions"]);
  });

  it("flags a dimension outside 1–2000 mm, by field", () => {
    expect(implausibleDims(mech({ length_mm: 5000 }))).toEqual(["length_mm"]);
    expect(implausibleDims(mech({ height_mm: 0.5 }))).toEqual(["height_mm"]);
    expect(partNeeds(mech({ length_mm: 5000 }))).toEqual(["implausible"]);
  });

  it("flags a wall thicker than half the smaller side", () => {
    const sheet = mech({ shape: "sheet", length_mm: 100, width_mm: 40, thickness_mm: 25 });
    expect(implausibleDims(sheet)).toEqual(["thickness_mm"]);
    expect(implausibleDims({ ...sheet, thickness_mm: 20 })).toEqual([]);
  });

  it("flags a disc wall thicker than its radius", () => {
    const disc = mech({ shape: "disc", diameter_mm: 40, thickness_mm: 25, length_mm: null, width_mm: null, height_mm: null });
    expect(implausibleDims(disc)).toEqual(["thickness_mm"]);
    expect(partNeeds(disc)).toEqual(["implausible"]);
    expect(implausibleDims({ ...disc, thickness_mm: 20 })).toEqual([]);
  });

  it("implausible numbers are reported before the fit check", () => {
    expect(partNeeds(mech({ length_mm: 30, width_mm: 30, height_mm: 5000 }), { boards: esp32 })).toEqual([
      "implausible",
    ]);
  });

  it("catalog and software parts are unaffected", () => {
    expect(partNeeds({ ...mech({}), source: "catalog", stock_status: "in_stock" }, { boards: esp32 })).toEqual([]);
    expect(partNeeds(mech({ kind: "software", description: "Firmware" }), { boards: esp32 })).toEqual([]);
  });
});

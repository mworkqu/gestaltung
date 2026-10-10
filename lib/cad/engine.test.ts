import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_WALL_MM,
  clientCheckSummary,
  cloudFilePaths,
  isCadQueryCode,
  mustContainBox,
  parseCadEngineSetting,
  parseManifest,
  resolveCadEngine,
  type CadEngineMode,
} from "./engine";
import { validateCadQuery } from "./validate";

describe("engine switch", () => {
  const table: [CadEngineMode, boolean, "browser" | "cloud"][] = [
    ["browser", false, "browser"],
    ["browser", true, "browser"],
    ["admin", false, "browser"],
    ["admin", true, "cloud"],
    ["cloud", false, "cloud"],
    ["cloud", true, "cloud"],
  ];
  it.each(table)("mode %s, super_admin %s → %s", (mode, admin, engine) => {
    expect(resolveCadEngine(mode, admin)).toBe(engine);
  });

  it("missing / malformed setting = browser", () => {
    expect(parseCadEngineSetting(null).mode).toBe("browser");
    expect(parseCadEngineSetting("not json").mode).toBe("browser");
    expect(parseCadEngineSetting({ engine: "gpu" }).mode).toBe("browser");
    expect(parseCadEngineSetting({}).minWallMm).toBe(DEFAULT_MIN_WALL_MM);
  });
  it("reads the row as object or string", () => {
    expect(parseCadEngineSetting({ engine: "admin", min_wall_mm: 2 })).toEqual({ mode: "admin", minWallMm: 2 });
    expect(parseCadEngineSetting('{"engine":"cloud"}')).toEqual({ mode: "cloud", minWallMm: 1.2 });
    expect(parseCadEngineSetting({ engine: "cloud", min_wall_mm: -1 }).minWallMm).toBe(1.2);
  });
});

describe("helpers", () => {
  it("tells CadQuery from OpenSCAD", () => {
    expect(isCadQueryCode("import cadquery as cq\nresult = 1")).toBe(true);
    expect(isCadQueryCode("// box\ncube([1,1,1]);")).toBe(false);
  });
  it("must-contain box = the largest known board", () => {
    expect(mustContainBox([])).toBeNull();
    const box = mustContainBox([
      { id: "arduino_nano", label: "Arduino Nano", length_mm: 45, width_mm: 18 },
      { id: "arduino_uno", label: "Arduino Uno", length_mm: 69, width_mm: 53 },
    ]);
    expect(box).toMatchObject({ x: 69, y: 53 });
  });
  it("file paths live under the owner's folder", () => {
    expect(cloudFilePaths("u", "p", "g")).toEqual({
      step: "u/p/cad/g.step",
      stl: "u/p/cad/g.stl",
      svg: "u/p/cad/g.svg",
      manifest: "u/p/cad/g.json",
    });
  });
  it("client check line: fits + measured wall, no names", () => {
    const m = parseManifest({
      engine: "cloud",
      bbox: { x: 1, y: 2, z: 3 },
      checks: [
        { name: "min_wall", pass: true, detail: "thinnest wall 2.0 mm" },
        { name: "must_contain_box", pass: true, detail: "ok" },
      ],
      minWallMm: 1.2,
      board: { label: "Arduino Uno", box: { x: 69, y: 53, z: 12 } },
    });
    expect(m).not.toBeNull();
    expect(clientCheckSummary(m!)).toEqual({ fits: true, wallMm: 2, allPass: true });
    expect(clientCheckSummary({ ...m!, board: null }).fits).toBeNull();
    expect(clientCheckSummary({ ...m!, checks: [{ name: "min_wall", pass: false, detail: "0.8 mm" }] }).allPass).toBe(false);
    expect(parseManifest({ engine: "browser" })).toBeNull();
  });
});

describe("validateCadQuery", () => {
  const good = "import cadquery as cq\nimport math\n\nwidth = 80  # mm\n\nresult = cq.Workplane('XY').box(width, 60, 30)\n";
  it("accepts a clean file", () => expect(validateCadQuery(good)).toEqual([]));
  it("needs `result` and the cadquery import", () => {
    expect(validateCadQuery("import math\nx = 1\n").join(" ")).toMatch(/cadquery/);
    expect(validateCadQuery("import cadquery as cq\nshape = 1\n").join(" ")).toMatch(/result/);
  });
  it("rejects other imports, file access and exports", () => {
    expect(validateCadQuery(`import os\n${good}`).join(" ")).toMatch(/"os"/);
    expect(validateCadQuery(`${good}open('/etc/passwd')\n`).length).toBeGreaterThan(0);
    expect(validateCadQuery(`${good}cq.exporters.export(result, 'a.step')\n`).length).toBeGreaterThan(0);
  });
  it("ignores words inside comments and strings", () => {
    expect(validateCadQuery(`${good}# do not open( anything\nlabel = "import os"\n`)).toEqual([]);
  });
});

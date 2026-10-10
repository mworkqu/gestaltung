import { describe, expect, it } from "vitest";

import { LIBRARY, getPart, makeLibrary } from "./index";
import { checkLibraryPart, mergeLibrary } from "./merge";
import { stlFit } from "./stl-fit";
import type { LibraryPart } from "../schema";

const led = getPart("led_5mm")!;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function newPart(id = "my_sensor"): LibraryPart {
  return { ...clone(led), id, name: { en: "My sensor", ar: "حساسي" }, storeSkus: ["VLT-1"] };
}

describe("mergeLibrary", () => {
  it("falls back to the code library with no rows (pre-0070 / error)", () => {
    for (const rows of [null, undefined, []]) {
      const m = mergeLibrary(LIBRARY, rows);
      expect(m.parts).toEqual(LIBRARY);
      expect(m.overrides).toEqual([]);
      expect(m.skipped).toEqual([]);
      expect(Object.values(m.source).every((s) => s === "code")).toBe(true);
    }
  });

  it("lets an owner edit override the code part with the same id", () => {
    const edited = { ...clone(led), storeSkus: ["VLT-123"] };
    const m = mergeLibrary(LIBRARY, [{ id: "led_5mm", data: edited, enabled: true }]);
    expect(m.parts).toHaveLength(LIBRARY.length);
    expect(m.parts.find((p) => p.id === "led_5mm")?.storeSkus).toEqual(["VLT-123"]);
    expect(m.source.led_5mm).toBe("edited");
    expect(m.overrides.map((p) => p.id)).toEqual(["led_5mm"]);
    // Position is kept.
    expect(m.parts.findIndex((p) => p.id === "led_5mm")).toBe(LIBRARY.findIndex((p) => p.id === "led_5mm"));
  });

  it("adds new parts after the code parts", () => {
    const m = mergeLibrary(LIBRARY, [{ id: "my_sensor", data: newPart(), enabled: true }]);
    expect(m.parts).toHaveLength(LIBRARY.length + 1);
    expect(m.parts.at(-1)?.id).toBe("my_sensor");
    expect(m.source.my_sensor).toBe("new");
    expect(makeLibrary(m.parts).getPart("my_sensor")?.name.en).toBe("My sensor");
  });

  it("uses the row id over the id inside data", () => {
    const m = mergeLibrary(LIBRARY, [{ id: "renamed", data: newPart("other"), enabled: true }]);
    expect(m.parts.at(-1)?.id).toBe("renamed");
  });

  it("skips and reports invalid rows; the code part stays", () => {
    const badSchema = { ...clone(led), category: "spaceship" };
    const badPort = clone(led);
    badPort.ports = [{ kind: "usb_c", face: "+x", at: { u: 0.5, v: 0.5 }, size: { w: 999, h: 3 } }];
    const m = mergeLibrary(LIBRARY, [
      { id: "led_5mm", data: badSchema, enabled: true },
      { id: "new_bad", data: badPort, enabled: true },
      { id: "junk", data: "not a part", enabled: true },
    ]);
    expect(m.parts).toEqual(LIBRARY);
    expect(m.skipped.map((s) => s.id).sort()).toEqual(["junk", "led_5mm", "new_bad"]);
    expect(m.skipped.find((s) => s.id === "new_bad")?.errors.join(" ")).toMatch(/bigger than/);
  });

  it("ignores disabled rows", () => {
    const m = mergeLibrary(LIBRARY, [
      { id: "led_5mm", data: { ...clone(led), storeSkus: ["X"] }, enabled: false },
      { id: "my_sensor", data: newPart(), enabled: false },
    ]);
    expect(m.parts).toEqual(LIBRARY);
  });

  it("accepts STL parts without the model size check but needs an https link", () => {
    const stl = { ...newPart("stl_part"), model: { kind: "stl", url: "https://x.supabase.co/storage/v1/object/public/studio-models/a.stl" } };
    expect(checkLibraryPart(stl).ok).toBe(true);
    const noUrl = { ...stl, model: { kind: "stl", url: "a.stl" } };
    const r = checkLibraryPart(noUrl);
    expect(r.ok).toBe(false);
    const noDims = { ...stl, dims: { x: 0, y: 10, z: 10 } };
    expect(checkLibraryPart(noDims).ok).toBe(false);
  });
});

describe("stlFit", () => {
  it("keeps a mesh that already matches dims and centres it", () => {
    const f = stlFit({ min: [10, 20, 5], max: [30, 30, 8] }, { x: 20, y: 10, z: 3 });
    expect(f.scale).toBe(1);
    expect(f.offset).toEqual([-20, -25, -5]);
  });
  it("scales uniformly to fit when far off (e.g. inches)", () => {
    const f = stlFit({ min: [0, 0, 0], max: [1, 0.5, 0.1] }, { x: 25.4, y: 12.7, z: 2.54 });
    expect(f.scale).toBeCloseTo(25.4);
    expect(f.offset[0]).toBeCloseTo(-12.7);
    expect(f.offset[2]).toBeCloseTo(0);
  });
});

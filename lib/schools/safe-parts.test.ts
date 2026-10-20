import { describe, expect, it } from "vitest";

import { CODE_LIBRARY } from "@/lib/studio/library/index";
import { classDocRefusal, classSafeLibrary, refusedParts } from "./safe-parts";

const comps = (...partIds: string[]) => partIds.map((partId) => ({ partId }));

describe("safety mode on the server", () => {
  const classLib = classSafeLibrary(CODE_LIBRARY);

  it("hands the pipeline a library with the unsafe parts gone", () => {
    expect(classLib.parts.length).toBeLessThan(CODE_LIBRARY.parts.length);
    expect(classLib.getPart("arduino_uno")).toBeTruthy();
    for (const id of ["relay_module", "lipo_1000", "psu_5v_5a", "mg996r_servo", "arduino_nano"]) {
      expect(classLib.getPart(id), id).toBeUndefined();
    }
  });

  it("keeps the helper parts the wiring rules need, so a class circuit can still be built", () => {
    // buildWiring adds these itself; dropping one would break every class circuit.
    for (const id of ["resistor_220", "led_5mm", "level_shifter_4ch"]) {
      expect(classLib.getPart(id), id).toBeTruthy();
    }
  });

  it("offers the AI only safe ids", () => {
    const ids = classLib.libraryIndexForAI().map((e) => e.id);
    expect(ids).toContain("sg90_servo");
    expect(ids).not.toContain("mg996r_servo");
    expect(ids).not.toContain("relay_module");
  });

  it("gives the pick cache a different key for a class project", () => {
    // pickKey() hashes the library's id list, so a class answer and a normal
    // answer can never share a cache entry.
    const a = CODE_LIBRARY.libraryIndexForAI().map((e) => e.id).sort().join(",");
    const b = classLib.libraryIndexForAI().map((e) => e.id).sort().join(",");
    expect(a).not.toBe(b);
  });

  it("names the parts a class may not use, once each, with a reason", () => {
    const refused = refusedParts(comps("arduino_uno", "relay_module", "lipo_1000", "relay_module"), CODE_LIBRARY);
    expect(refused).toEqual([
      { partId: "relay_module", reason: "denied" },
      { partId: "lipo_1000", reason: "supply_not_allowed" },
    ]);
  });

  it("ignores a part id that is not in the library at all", () => {
    // StudioDocSchema allows any string; safety mode only judges real parts.
    expect(refusedParts(comps("made_up_part"), CODE_LIBRARY)).toEqual([]);
  });

  it("refuses a class document that names an unsafe part, and passes a safe one", () => {
    expect(classDocRefusal(comps("arduino_uno", "sg90_servo", "resistor_220"), CODE_LIBRARY)).toBe(null);
    expect(classDocRefusal(comps("arduino_uno", "relay_module"), CODE_LIBRARY)).toEqual({
      error: "unsafe_part",
      parts: ["relay_module"],
    });
  });
});

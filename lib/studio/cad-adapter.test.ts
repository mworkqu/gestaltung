import { afterEach, describe, expect, it, vi } from "vitest";
import { getPart } from "./library";
import { layoutComponents } from "./layout";
import { BrowserCadBackend, type CadBackend, CadQueryBackend, getCadBackend, parseStudioCadSetting } from "./cad-adapter";
import { spec } from "./enclosure/test-fixtures";

afterEach(() => vi.restoreAllMocks());

describe("studio_cad setting", () => {
  it("missing / invalid / browser give browser", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of [undefined, null, 5, "", "not json", {}, { backend: "browser" }, '{"backend":"browser"}', { backend: 3 }]) {
      expect(parseStudioCadSetting(raw)).toBe("browser");
    }
  });

  it("cadquery is not accepted yet: browser + warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseStudioCadSetting({ backend: "cadquery" })).toBe("browser");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getCadBackend("cadquery").id).toBe("browser");
    expect(getCadBackend({ backend: "cadquery" }).id).toBe("browser");
    expect(getCadBackend().id).toBe("browser");
  });

  it("the cadquery stub throws", async () => {
    const b: CadBackend = new CadQueryBackend();
    await expect(b.buildEnclosure(spec(), {} as never, new Map())).rejects.toThrow("not enabled");
  });
});

describe("BrowserCadBackend", () => {
  it("builds an enclosure for a small real-library set", async () => {
    const ids = ["esp32_devkit", "button_6mm", "led_5mm"];
    const list = ids.map((id, i) => ({ instanceId: `${id}_${i}`, part: getPart(id)! }));
    const parts = new Map(list.map((i) => [i.instanceId, i.part]));
    const lr = layoutComponents(list, { clearance: 2 });
    const out = await new BrowserCadBackend().buildEnclosure(spec(), lr, parts);
    expect(out.base.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(out.lid.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(out.meta.cutouts.length).toBeGreaterThan(0);
    const mech = await new BrowserCadBackend().buildMechPart({
      id: "standoff_1", template: "standoff", params: { height: 6, outerD: 6, holeD: 2.5 },
      printable: { material: "PLA", estGrams: 1 },
    });
    expect(mech.name).toBe("standoff_1");
  });
});

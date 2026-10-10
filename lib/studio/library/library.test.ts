import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIBRARY, getPart, libraryIndexForAI, partsByCategory, validatePart } from "./index";
import { BUILDERS, buildPartModel } from "../models";
import { LibraryPartSchema, CATEGORIES } from "../schema";

const ids = ["esp32_devkit", "arduino_uno", "cell_18650", "tp4056_usbc", "pir_hcsr501", "dht22", "oled_096_i2c", "button_6mm", "led_5mm", "resistor_220"];

function vertexCount(g: THREE.Group): number {
  let n = 0;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) n += (o.geometry as THREE.BufferGeometry).getAttribute("position").count;
  });
  return n;
}
function triangleCount(g: THREE.Group): number {
  let n = 0;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const geo = o.geometry as THREE.BufferGeometry;
      n += geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3;
    }
  });
  return n;
}

describe("library", () => {
  it("has the Phase 1 parts", () => {
    expect(LIBRARY.map((p) => p.id).sort()).toEqual([...ids].sort());
  });

  it("ids are unique", () => {
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length);
  });

  it.each(ids)("%s passes validatePart with zero errors", (id) => {
    const part = getPart(id)!;
    expect(validatePart(part)).toEqual([]);
    expect(LibraryPartSchema.safeParse(part).success).toBe(true);
  });

  it("every requires target exists", () => {
    for (const p of LIBRARY) for (const r of p.requires ?? []) expect(getPart(r.id), `${p.id} -> ${r.id}`).toBeDefined();
  });

  it("builders are deterministic and light", () => {
    for (const p of LIBRARY) {
      const a = buildPartModel(p);
      const b = buildPartModel(p);
      expect(vertexCount(a)).toBe(vertexCount(b));
      expect(a.children.length).toBe(b.children.length);
      expect(a.children.map((c) => c.name)).toEqual(b.children.map((c) => c.name));
      expect(triangleCount(a), `${p.id} triangles`).toBeLessThan(3000);
      expect(a.name).toBe(p.id);
      a.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          expect(o.name.length, `${p.id} unnamed mesh`).toBeGreaterThan(0);
          expect(o.material instanceof THREE.MeshStandardMaterial).toBe(true); // Physical extends Standard
        }
      });
    }
  });

  it("every procedural part uses a registered builder", () => {
    for (const p of LIBRARY) if (p.model.kind === "procedural") expect(BUILDERS[p.model.builder]).toBeDefined();
  });

  it("stl parts and unknown builders get a placeholder box of the part's size", () => {
    const base = getPart("dht22")!;
    for (const model of [{ kind: "stl" as const, url: "/x.stl" }, { kind: "procedural" as const, builder: "nope", params: {} }]) {
      const g = buildPartModel({ ...base, model });
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(base.dims.x, 1);
      expect(size.y).toBeCloseTo(base.dims.y, 1);
      expect(size.z).toBeCloseTo(base.dims.z, 1);
    }
  });

  it("validatePart catches broken parts", () => {
    const base = getPart("esp32_devkit")!;
    const dup = validatePart({ ...base, pins: [...base.pins, base.pins[0]] });
    expect(dup.some((e) => e.includes("duplicate pin"))).toBe(true);
    const bigPort = validatePart({ ...base, ports: [{ kind: "usb_micro", face: "-x", at: { u: 0.5, v: 0.5 }, size: { w: 99, h: 3 } }] });
    expect(bigPort.some((e) => e.includes("bigger than"))).toBe(true);
    const edgePort = validatePart({ ...base, ports: [{ kind: "usb_micro", face: "-x", at: { u: 0.99, v: 0.5 }, size: { w: 8, h: 3 } }] });
    expect(edgePort.some((e) => e.includes("sticks out"))).toBe(true);
    const hole = validatePart({ ...base, mount: { holes: [{ x: 40, y: 0, d: 3 }], standoffHeight: 3 } });
    expect(hole.some((e) => e.includes("mount hole"))).toBe(true);
    const noBuilder = validatePart({ ...base, model: { kind: "procedural", builder: "ghost", params: {} } });
    expect(noBuilder.some((e) => e.includes("not registered"))).toBe(true);
    const badSchema = validatePart({ ...base, id: "Bad Id" });
    expect(badSchema.some((e) => e.includes("schema"))).toBe(true);
  });

  it("getPart / partsByCategory work", () => {
    expect(getPart("esp32_devkit")?.category).toBe("mcu");
    expect(getPart("nope")).toBeUndefined();
    expect(partsByCategory("mcu").map((p) => p.id).sort()).toEqual(["arduino_uno", "esp32_devkit"]);
    expect(partsByCategory("output")).toEqual([]); // led is a helper
    expect(partsByCategory("output", true).map((p) => p.id)).toEqual(["led_5mm"]);
    for (const c of CATEGORIES) expect(Array.isArray(partsByCategory(c))).toBe(true);
  });

  it("libraryIndexForAI excludes helpers and keeps the compact shape", () => {
    const idx = libraryIndexForAI();
    expect(idx.map((e) => e.id)).not.toContain("led_5mm");
    expect(idx.map((e) => e.id)).not.toContain("resistor_220");
    expect(idx).toHaveLength(LIBRARY.filter((p) => !p.helper).length);
    const esp = idx.find((e) => e.id === "esp32_devkit")!;
    expect(Object.keys(esp).sort()).toEqual(["category", "id", "logicV", "name", "power", "tags"]);
    expect(esp.name).toBe(getPart("esp32_devkit")!.name.en);
    expect(esp.logicV).toBe(3.3);
  });

  it("pin facts match the real boards", () => {
    const esp = getPart("esp32_devkit")!;
    expect(esp.pins.find((p) => p.id === "GPIO21")?.role).toBe("i2c_sda");
    expect(esp.pins.find((p) => p.id === "GPIO22")?.role).toBe("i2c_scl");
    expect(esp.mount).toBeNull();
    const uno = getPart("arduino_uno")!;
    expect(uno.power.logicV).toBe(5);
    expect(uno.mount?.holes).toHaveLength(4);
    expect(uno.pins.find((p) => p.id === "A4")?.role).toBe("i2c_sda");
    expect(uno.pins.find((p) => p.id === "A4")?.label).toContain("SDA");
    expect(uno.pins.filter((p) => /^D([2-9]|1[0-3])$/.test(p.id))).toHaveLength(12);
    expect(getPart("pir_hcsr501")!.mount?.holes).toHaveLength(2);
    expect(getPart("oled_096_i2c")!.mount?.holes).toHaveLength(4);
    expect(getPart("led_5mm")!.requires?.[0].id).toBe("resistor_220");
    expect(getPart("pir_hcsr501")!.requires).toBeUndefined();
    expect(getPart("cell_18650")!.power).toMatchObject({ vMin: 3.0, vMax: 4.2 });
  });

  it("bilingual text is present and storeSkus never invented", () => {
    for (const p of LIBRARY) {
      expect(p.name.en.length).toBeGreaterThan(2);
      expect(/[؀-ۿ]/.test(p.name.ar), `${p.id} name.ar`).toBe(true);
      expect(/[؀-ۿ]/.test(p.blurb.ar), `${p.id} blurb.ar`).toBe(true);
      expect(p.blurb.en.length).toBeGreaterThan(10);
      expect(p.storeSkus).toEqual([]);
    }
  });
});

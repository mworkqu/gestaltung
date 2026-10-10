import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIBRARY, getPart, libraryIndexForAI, partsByCategory } from "./index";
import { validatePart } from "./validate";
import { BUILDERS, buildPartModel } from "../models";
import { LibraryPartSchema, CATEGORIES, PORT_KINDS, PIN_ROLES, DEFAULT_SPEC, type StudioComponent } from "../schema";
import {
  buildNetlist, buildWiring, isBattery, isButton, isCharger, isConverter, isDriver, isInductive,
  isMcu, isShifter, isPowerSource, shifterChannels, LEVEL_SHIFTER_IDS, DRIVER_IDS,
} from "../netlist";

const phase1Ids = ["esp32_devkit", "arduino_uno", "cell_18650", "tp4056_usbc", "pir_hcsr501", "dht22", "oled_096_i2c", "button_6mm", "led_5mm", "resistor_220"];
const phase2Ids = [
  "esp32_c3_mini", "pico_w", "arduino_nano", "aa_holder_2", "lipo_1000", "usbc_power_5v", "boost_5v", "buck_converter",
  "hcsr04", "bh1750", "soil_moisture_cap", "mpu6050", "ds18b20", "ldr_module", "oled_13_i2c", "lcd1602_i2c",
  "ws2812_ring", "buzzer", "speaker_amp", "relay_module", "sg90_servo", "n20_motor", "motor_driver",
  "rotary_encoder", "slide_switch", "microsd_module", "rtc_ds3231", "usbc_breakout", "level_shifter_4ch",
];
const ids = [...phase1Ids, ...phase2Ids];

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
  it("has the Phase 1 + 2 parts", () => {
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
    expect(partsByCategory("mcu").map((p) => p.id).sort()).toEqual(["arduino_nano", "arduino_uno", "esp32_c3_mini", "esp32_devkit", "pico_w"]);
    expect(partsByCategory("output").map((p) => p.id).sort()).toEqual(["buzzer", "speaker_amp", "ws2812_ring"]); // led is a helper
    expect(partsByCategory("output", true).map((p) => p.id).sort()).toEqual(["buzzer", "led_5mm", "speaker_amp", "ws2812_ring"]);
    for (const c of CATEGORIES) expect(Array.isArray(partsByCategory(c))).toBe(true);
  });

  it("libraryIndexForAI excludes helpers and keeps the compact shape", () => {
    const idx = libraryIndexForAI();
    expect(idx.map((e) => e.id)).not.toContain("led_5mm");
    expect(idx.map((e) => e.id)).not.toContain("resistor_220");
    expect(idx.map((e) => e.id)).not.toContain("level_shifter_4ch");
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

  it("only the three internal helpers are hidden from the picker", () => {
    expect(LIBRARY.filter((p) => p.helper).map((p) => p.id).sort()).toEqual(["led_5mm", "level_shifter_4ch", "resistor_220"]);
  });

  it("every part uses known port kinds, pin roles, unique pin ids and rich tags", () => {
    for (const p of LIBRARY) {
      for (const port of p.ports) expect(PORT_KINDS).toContain(port.kind);
      for (const pin of p.pins) expect(PIN_ROLES).toContain(pin.role);
      expect(new Set(p.pins.map((x) => x.id)).size, `${p.id} pin ids`).toBe(p.pins.length);
      expect(p.tags.length, `${p.id} tags`).toBeGreaterThanOrEqual(6);
    }
  });

  it("the library has every helper and driver id the wiring looks up", () => {
    expect(getPart(LEVEL_SHIFTER_IDS[0])).toBeDefined();
    expect(DRIVER_IDS.some((id) => !!getPart(id))).toBe(true);
    expect(getPart("motor_driver")).toBeDefined();
    expect(getPart("relay_module")).toBeDefined();
  });

  it("new parts fit the wiring classifiers", () => {
    const part = (id: string) => getPart(id)!;
    for (const id of ["esp32_c3_mini", "pico_w", "arduino_nano"]) expect(isMcu(part(id))).toBe(true);
    expect(isBattery(part("aa_holder_2"))).toBe(true);
    expect(isBattery(part("lipo_1000"))).toBe(true);
    // The booster is a converter (vin in, 5v out), never a cell or a charger.
    expect(isConverter(part("boost_5v"))).toBe(true);
    expect(isBattery(part("boost_5v"))).toBe(false);
    expect(isCharger(part("boost_5v"))).toBe(false);
    expect(isPowerSource(part("boost_5v"))).toBe(true);
    expect(isConverter(part("buck_converter"))).toBe(true);
    expect(isBattery(part("buck_converter"))).toBe(false);
    for (const id of ["usbc_power_5v", "usbc_breakout"]) expect(isPowerSource(part(id))).toBe(false);
    expect(isShifter(part("level_shifter_4ch"))).toBe(true);
    expect(shifterChannels(part("level_shifter_4ch"))).toHaveLength(4);
    // A bare motor is an inductive load; the driver board and the relay module are drivers.
    expect(isInductive(part("n20_motor"))).toBe(true);
    expect(isDriver(part("n20_motor"))).toBe(false);
    for (const id of ["motor_driver", "relay_module"]) {
      expect(isDriver(part(id))).toBe(true);
      expect(isInductive(part(id))).toBe(false);
    }
    expect(isInductive(part("sg90_servo"))).toBe(false);
    expect(isInductive(part("speaker_amp"))).toBe(false);
    expect(isInductive(part("buzzer"))).toBe(false);
    expect(isButton(part("slide_switch"))).toBe(true);
    expect(isButton(part("rotary_encoder"))).toBe(false);
    for (const id of ["soil_moisture_cap", "ldr_module"]) expect(part(id).tags).toContain("analog");
    expect(part("ds18b20").tags).toContain("onewire");
    expect(part("buzzer").tags).toEqual(expect.arrayContaining(["buzzer", "pwm"]));
    expect(part("sg90_servo").tags).toEqual(expect.arrayContaining(["servo", "pwm"]));
  });

  it("port placement and logic levels match the real parts", () => {
    const us = getPart("hcsr04")!;
    expect(us.ports).toHaveLength(2);
    expect(us.ports.every((p) => p.kind === "sensor_window" && p.face === "+y")).toBe(true);
    expect(getPart("speaker_amp")!.ports[0]).toMatchObject({ kind: "speaker_grille", face: "+z" });
    expect(getPart("rotary_encoder")!.ports[0]).toMatchObject({ kind: "button_cap", face: "+z" });
    expect(getPart("slide_switch")!.ports[0]).toMatchObject({ kind: "button_cap", face: "+y" });
    expect(getPart("lcd1602_i2c")!.ports[0].kind).toBe("display_window");
    expect(getPart("oled_13_i2c")!.ports[0].kind).toBe("display_window");
    expect(getPart("ws2812_ring")!.ports[0]).toMatchObject({ kind: "display_window", face: "+z" });
    expect(getPart("usbc_breakout")!.ports[0].kind).toBe("usb_c");
    expect(getPart("esp32_c3_mini")!.ports[0].kind).toBe("usb_c");
    expect(getPart("pico_w")!.ports[0].kind).toBe("usb_micro");
    expect(getPart("arduino_nano")!.power.logicV).toBe(5);
    expect(getPart("pico_w")!.power.logicV).toBe(3.3);
    expect(getPart("lcd1602_i2c")!.power.logicV).toBe(5);
  });

  describe("wiring with the new parts", () => {
    const comp = (partId: string): StudioComponent => ({ partId, instanceId: `${partId}_1`, label: partId });
    const wire = (partIds: string[]) => buildWiring(partIds.map(comp), DEFAULT_SPEC, getPart, "en");

    it("a bare motor gets a driver automatically", () => {
      const r = wire(["esp32_devkit", "n20_motor"]);
      expect(r.added.map((a) => a.partId)).toContain("motor_driver");
    });

    it("an ultrasonic sensor on a 3.3 V board gets a level shifter", () => {
      expect(wire(["esp32_devkit", "hcsr04"]).added.map((a) => a.partId)).toContain("level_shifter_4ch");
    });

    it("a 5 V I2C screen on a 3.3 V board gets a shifter, 3.3 V I2C parts do not", () => {
      expect(wire(["esp32_devkit", "lcd1602_i2c"]).added.map((a) => a.partId)).toContain("level_shifter_4ch");
      expect(wire(["esp32_devkit", "oled_13_i2c", "bh1750", "mpu6050"]).added).toEqual([]);
    });

    it("the new output and input parts find board pins on every supported board", () => {
      for (const mcu of ["esp32_devkit", "esp32_c3_mini", "pico_w", "arduino_nano", "arduino_uno"]) {
        const r = wire([mcu, "relay_module", "sg90_servo", "ws2812_ring", "ldr_module", "buzzer"]);
        const s = wire([mcu, "rotary_encoder", "slide_switch", "soil_moisture_cap", "ds18b20"]);
        expect(s.unconnected, mcu).toEqual([]);
        // The only acceptable open pins are 5 V supplies on boards with no 5 V rail.
        expect(r.unconnected.filter((u) => !/\.(VCC|VBUS)$/.test(u)), mcu).toEqual([]);
      }
    });

    it("the booster makes a battery build usable with 5 V parts", () => {
      const withBoost = buildNetlist(["esp32_devkit", "lipo_1000", "boost_5v", "hcsr04"].map(comp), DEFAULT_SPEC, getPart);
      expect(withBoost.nets.find((n) => n.name === "VREG")?.pins).toContain("boost_5v_1.OUT_5V");
      expect(withBoost.unconnected).not.toContain("hcsr04_1.VCC");
      const without = buildNetlist(["esp32_devkit", "lipo_1000", "hcsr04"].map(comp), DEFAULT_SPEC, getPart);
      expect(without.unconnected).toContain("hcsr04_1.VCC");
    });
  });
});

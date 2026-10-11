import { describe, expect, it } from "vitest";

import { rankProducts, type SearchableProduct } from "@/lib/store/search";

// Real product names from the live catalogue (W7 instant search ranking).
const p = (id: string, name: string, category: string, extra: Partial<SearchableProduct> = {}): SearchableProduct => ({
  id,
  name,
  sku: `VLT-${id}`,
  category,
  unit_price: 10,
  lead_time_class: "in_stock",
  ...extra,
});

const MOTORS = "Motors and mechanical";
const MOTOR_FIXTURE: SearchableProduct[] = [
  p("fan3", "DC Motor Propeller Fan – 3 Blades, 2mm Shaft", MOTORS),
  p("fan4", "DC Motor Propeller Fan – 4 Blades, 2mm Shaft", MOTORS),
  p("ctrl", "DC Motor Speed Controller – 10–60V 20A 1200W PWM Regulator", "Power"),
  p("wheel", "Mini DC motor Plastic Wheel", MOTORS),
  p("rf300", "Small DC Motor RF-300 – High Speed 3–12V Brushed Motor", MOTORS),
  p("tt", "TT DC Motor with Metal Gears – 1:90 Gear Ratio", MOTORS),
  p("vib", "DC Vibration Motor – 3–6V Micro Cylindrical Motor with Eccentric Weight", MOTORS),
  p("drv", "DRV8825 Stepper Motor Driver Module – 1/32 Microstepping", "Modules"),
  p("shield", "L293D Motor Driver Shield – Dual H-Bridge for Arduino", "Modules"),
  p("geared", "12V DC Geared Motor 36-555 with Encoder – 11RPM High Torque", MOTORS),
];
const MOTOR_IDS = ["rf300", "tt", "vib", "geared"];
const ACCESSORY_IDS = ["fan3", "fan4", "ctrl", "wheel", "drv", "shield"];

const ids = (q: string, list: SearchableProduct[]) => rankProducts(q, list).map((x) => x.id);

describe("rankProducts - the product itself above its accessories", () => {
  for (const q of ["dc motor", "motor"]) {
    it(`"${q}": every motor ranks above every fan / wheel / controller / driver / shield`, () => {
      const ranked = ids(q, MOTOR_FIXTURE);
      const lastMotor = Math.max(...MOTOR_IDS.map((i) => ranked.indexOf(i)));
      const firstAccessory = Math.min(...ACCESSORY_IDS.map((i) => ranked.indexOf(i)));
      expect(lastMotor).toBeLessThan(firstAccessory);
    });
  }

  it("the top four for 'dc motor' are the motors", () => {
    expect(ids("dc motor", MOTOR_FIXTURE).slice(0, 4).sort()).toEqual([...MOTOR_IDS].sort());
  });

  it("asking for the accessory brings it back first", () => {
    expect(ids("motor driver", MOTOR_FIXTURE).slice(0, 2).sort()).toEqual(["drv", "shield"]);
    expect(ids("fan", MOTOR_FIXTURE).slice(0, 2).sort()).toEqual(["fan3", "fan4"]);
  });

  it("the head ignores model codes and a 'with ...' tail", () => {
    const list = [p("tt", "TT DC Motor with Metal Gears – 1:90 Gear Ratio", MOTORS), p("g", "Metal Gear 20T", MOTORS)];
    expect(ids("motor", list)[0]).toBe("tt");
  });

  it("esp32: dev boards rank above the USB programmer board", () => {
    const list = [
      p("prog", "ESP32-CAM USB Programmer Board – USB to UART Interface", "Boards and microcontrollers"),
      p("cam", "ESP32-CAM Wireless IoT Vision Development Board – Wi-Fi & Camera", "Boards and microcontrollers"),
      p("s3", "ESP32-S3 DevKitC-1 N16R8 Development Board", "Boards and microcontrollers"),
      p("nodemcu", "NodeMCU ESP32 Development Board – Wi-Fi & Bluetooth Enabled", "Boards and microcontrollers"),
      p("heltec", "Heltec ESP32 LoRa 32 V4 Development Board with OLED Display", "Boards and microcontrollers"),
    ];
    const ranked = ids("esp32", list);
    expect(ranked[ranked.length - 1]).toBe("prog");
  });

  it("soil sensor: the soil sensors come before unrelated sensors and kits", () => {
    const list = [
      p("kit", "Voltaat Arduino Ultimate Kit", "Kits"),
      p("rain", "Raindrops Detection Sensor Module – Analog and Digital Output", "Sensors"),
      p("soil", "Soil Moisture Sensor Module – Analog and Digital Output", "Sensors"),
      p("cap", "Capacitive Analog Soil Moisture Sensor – 3.3–5.5V Output", "Sensors"),
      p("multi", "Soil Multifunctional 7-in-1 Sensor – RS485 Output", "Sensors"),
    ];
    expect(ids("soil sensor", list).slice(0, 3).sort()).toEqual(["cap", "multi", "soil"]);
  });

  it("in stock wins a score tie", () => {
    const a = p("a", "Small DC Motor", MOTORS, { lead_time_class: "2_4_weeks" });
    const b = p("b", "Small DC Motor", MOTORS, { lead_time_class: "in_stock" });
    expect(ids("dc motor", [a, b])).toEqual(["b", "a"]);
  });

  it("still matches the Arabic name", () => {
    const ar = p("m", "Hobby Motor", MOTORS, { name_ar: "محرك تيار مستمر" });
    const other = p("o", "Relay", "Modules", { name_ar: "مرحل" });
    expect(ids("محرك", [other, ar])[0]).toBe("m");
  });
});

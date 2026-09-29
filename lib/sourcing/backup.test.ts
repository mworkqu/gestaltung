import { describe, expect, it } from "vitest";

import { carriesModel, modelCodes, pickBackup } from "./backup";
import type { SupplierProduct } from "./types";

const result = (over: Partial<SupplierProduct>): SupplierProduct => ({
  supplierCode: "digikey",
  supplierSku: "X",
  mpn: null,
  manufacturer: null,
  name: "",
  description: null,
  category: null,
  imageUrl: null,
  url: null,
  datasheetUrl: null,
  cost: 1,
  currency: "USD",
  availability: "in_stock",
  leadTimeDays: 7,
  moq: 1,
  parameters: [],
  ...over,
});

describe("modelCodes", () => {
  it("reads model codes, not values or plain words", () => {
    expect(modelCodes("Ultrasonic Distance Sensor HC-SR04")).toEqual(["HC-SR04"]);
    expect(modelCodes("DRV8833 Dual H-Bridge Motor Driver Module")).toEqual(["DRV8833"]);
    expect(modelCodes("Resistor 10k 1/4W 5mm")).toEqual([]);
    expect(modelCodes("APISQUEEN U1 Underwater Thruster")).toEqual([]);
    expect(modelCodes("ESP32-S3 DevKitC-1 N16R8 Development Board")).toEqual(["DevKitC-1", "ESP32-S3", "N16R8"]);
  });
});

describe("pickBackup", () => {
  it("accepts only the same model, with a price", () => {
    const wrong = result({ mpn: "HC-SR501", description: "PIR sensor" });
    const right = result({ mpn: "SEN0001", description: "Ultrasonic sensor HC-SR04 compatible" });
    expect(pickBackup([wrong, right], "HC-SR04")).toBe(right);
    expect(pickBackup([result({ mpn: "HCSR04", cost: null })], "HC-SR04")).toBeNull();
    expect(carriesModel({ mpn: "DRV8833PWPR", name: "", description: null }, "DRV8833")).toBe(true);
  });
});

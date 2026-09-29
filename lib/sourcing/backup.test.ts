import { describe, expect, it } from "vitest";

import { carriesModel, isComponent, modelCodes, pickBackup } from "./backup";
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

describe("isComponent", () => {
  it("keeps modules, boards and kits away from distributor chips", () => {
    expect(isComponent("DRV8833 Dual H-Bridge Motor Driver Module")).toBe(false);
    expect(isComponent("ESP32-S3 DevKitC-1 N16R8 Development Board")).toBe(false);
    expect(isComponent("NE555 Timer IC DIP-8")).toBe(true);
    expect(isComponent("IRF540N N-Channel MOSFET")).toBe(true);
  });
});

describe("modelCodes", () => {
  it("reads specific codes, not values, sizes or short codes", () => {
    expect(modelCodes("IRF540N N-Channel MOSFET")).toEqual(["IRF540N"]);
    expect(modelCodes("NE555 Timer IC")).toEqual(["NE555"]);
    expect(modelCodes("Capacitor 1000uF 25V 0402 X5R")).toEqual([]);
    expect(modelCodes("Battery 18650 3.7V 2600mAh")).toEqual([]);
    expect(modelCodes("Resistor 10k 1/4W")).toEqual([]);
  });
});

describe("pickBackup", () => {
  it("needs the part number to start with the code", () => {
    expect(carriesModel({ mpn: "IRF540NPBF" }, "IRF540N")).toBe(true);
    expect(carriesModel({ mpn: "SEN0001" }, "HC-SR04")).toBe(false);
    const right = result({ mpn: "NE555P" });
    expect(pickBackup([result({ mpn: "TLC555CP" }), right], "NE555")).toBe(right);
    expect(pickBackup([result({ mpn: "NE555P", cost: null })], "NE555")).toBeNull();
  });
});

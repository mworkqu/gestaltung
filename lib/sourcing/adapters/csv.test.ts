import { describe, expect, it } from "vitest";

import { guessMapping, parseAmount, parseAvailability, readCsv, toOffers } from "./csv";

describe("parseAmount", () => {
  it("reads currency-decorated and grouped numbers", () => {
    expect(parseAmount("QAR 1,250.50")).toBe(1250.5);
    expect(parseAmount("$3.20")).toBe(3.2);
    expect(parseAmount("1,250")).toBe(1250);
    expect(parseAmount("3,5")).toBe(3.5);
  });
  it("treats blanks as unknown and junk as invalid", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("parseAvailability", () => {
  it("maps quantities without keeping them", () => {
    expect(parseAvailability("12")).toBe("in_stock");
    expect(parseAvailability("0")).toBe("unavailable");
  });
  it("maps words", () => {
    expect(parseAvailability("In stock")).toBe("in_stock");
    expect(parseAvailability("Out of stock")).toBe("unavailable");
    expect(parseAvailability("Pre-order")).toBe("backorder");
    expect(parseAvailability("Low stock")).toBe("limited");
    expect(parseAvailability("maybe")).toBe("unknown");
  });
});

describe("guessMapping", () => {
  it("guesses common headers and lets a saved mapping win", () => {
    const h = ["SKU", "Product Name", "Price", "Stock", "Lead time (days)"];
    expect(guessMapping(h)).toMatchObject({
      supplierSku: "SKU",
      name: "Product Name",
      retailPrice: "Price",
      availability: "Stock",
      leadTimeDays: "Lead time (days)",
    });
    expect(guessMapping(h, { cost: "Price" }).cost).toBe("Price");
    expect(guessMapping(h, { cost: "Price" }).retailPrice).toBeUndefined();
  });
});

describe("toOffers", () => {
  const csv = readCsv(
    "﻿SKU,Name,Price,Stock\nV-100,Arduino Uno,QAR 95,In stock\n,No sku,10,1\nV-101,Servo,abc,0\nV-100,Duplicate,99,1\nV-102,LED,\"1,5\",0\n"
  );
  const { offers, errors } = toOffers(csv, { supplierSku: "SKU", name: "Name", retailPrice: "Price", availability: "Stock" });

  it("keeps good rows, first row wins for a repeated SKU", () => {
    expect(offers.map((o) => o.supplierSku)).toEqual(["V-100", "V-102"]);
    expect(offers[0]).toMatchObject({ retailPrice: 95, availability: "in_stock", name: "Arduino Uno" });
    expect(offers[1]).toMatchObject({ retailPrice: 1.5, availability: "unavailable" });
  });
  it("reports rows it cannot read instead of guessing", () => {
    expect(errors).toEqual([
      { row: 3, reason: "no_sku" },
      { row: 4, reason: "bad_number", field: "retailPrice" },
    ]);
  });
});

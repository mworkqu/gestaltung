import { describe, expect, it } from "vitest";

import {
  buildOrderGroups,
  classifyStock,
  groupsCsv,
  interestOf,
  peopleCount,
  suggestedQty,
  whatsappText,
  type StockPart,
  type StockSignal,
} from "./stock-lists";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 864e5).toISOString();

const supplier = { id: "s1", name: "Voltaat", minOrderValue: 100 };
const part = (id: string, over: Partial<StockPart> = {}): StockPart => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  photo: null,
  price: 20,
  landedCost: 10,
  supplier,
  supplierSku: `V-${id}`,
  supplierUrl: null,
  moq: 1,
  leadTimeClass: "in_stock",
  ownQty: 0,
  ...over,
});
const sig = (partId: string, kind: StockSignal["kind"], d: number, extra: Partial<StockSignal> = {}): StockSignal => ({
  partId,
  kind,
  createdAt: daysAgo(d),
  ...extra,
});

describe("people and interest", () => {
  it("counts distinct people, guests with no id one each", () => {
    expect(peopleCount([{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }, { userId: null }, {}])).toBe(4);
  });
  it("splits recent from older", () => {
    const i = interestOf(
      [
        sig("a", "add_to_cart", 2, { userId: "u1" }),
        sig("a", "add_to_cart", 3, { userId: "u1" }),
        sig("a", "add_to_cart", 40, { userId: "u9" }),
        sig("a", "request", 1, { userId: "u2", quantity: 5 }),
        sig("a", "view", 1),
        sig("a", "view", 90),
      ],
      NOW
    );
    expect(i).toEqual({ cartPeople: 1, requestPeople: 1, requestedQty: 5, olderSignals: 1, views: 2 });
  });
});

describe("classifyStock", () => {
  const parts = [
    part("buyme"),
    part("have", { ownQty: 4 }),
    part("old"),
    part("views"),
    part("none"),
    part("test", { name: "TEST product" }),
    part("flag", { isTest: true }),
  ];
  const signals: StockSignal[] = [
    sig("buyme", "add_to_cart", 3, { userId: "u1" }),
    sig("buyme", "add_to_cart", 5, { userId: "u2" }),
    sig("buyme", "request", 2, { userId: "u3", quantity: 3 }),
    sig("have", "add_to_cart", 1, { userId: "u1" }),
    sig("old", "request", 45, { userId: "u1", quantity: 2 }),
    sig("views", "view", 1),
    sig("test", "add_to_cart", 1, { userId: "u1" }),
    sig("flag", "request", 1, { userId: "u1" }),
  ];
  const lists = classifyStock(parts, signals, { now: NOW });
  const ids = (l: { part: StockPart }[]) => l.map((x) => x.part.id);

  it("buy = recent cart or request and none in stock", () => {
    expect(ids(lists.buy)).toEqual(["buyme"]);
  });
  it("watch = we have some, older signals, or views only", () => {
    expect(ids(lists.watch).sort()).toEqual(["have", "old", "views"]);
  });
  it("dont = no interest; test products are gone everywhere", () => {
    expect(ids(lists.dont)).toEqual(["none"]);
    const all = [...lists.buy, ...lists.watch, ...lists.dont].map((x) => x.part.id);
    expect(all).not.toContain("test");
    expect(all).not.toContain("flag");
  });
  it("suggested quantity = requested units + one per cart person, at least the supplier minimum", () => {
    // 3 requested units + 2 cart people = 5
    expect(lists.buy[0].qty).toBe(5);
    expect(suggestedQty({ moq: 10, ownQty: 0 }, interestOf([sig("x", "add_to_cart", 1, { userId: "u" })], NOW))).toBe(10);
    expect(suggestedQty({ moq: 1, ownQty: 0 }, interestOf([], NOW))).toBe(1);
  });
  it("what we hold is taken off the suggestion", () => {
    const i = interestOf(
      [sig("x", "request", 1, { userId: "a", quantity: 6 }), sig("x", "add_to_cart", 1, { userId: "b" })],
      NOW
    );
    expect(suggestedQty({ moq: 1, ownQty: 2 }, i)).toBe(5);
    expect(suggestedQty({ moq: 1, ownQty: 99 }, i)).toBe(1);
  });
});

describe("order lists", () => {
  const a = part("a", { name: "Relay module" });
  const b = part("b", { name: "ESP32", supplier: { id: "s2", name: "DigiKey", minOrderValue: null }, supplierSku: "DK-1" });
  const c = part("c", { name: "Loose part", supplier: null, supplierSku: null, landedCost: null });
  const items = classifyStock(
    [a, b, c],
    [a, b, c].map((p) => sig(p.id, "request", 1, { userId: "u", quantity: 2 })),
    { now: NOW }
  ).buy;

  it("groups per supplier and writes plain WhatsApp text", () => {
    const groups = buildOrderGroups(items, { a: 4, b: 1, c: 2 });
    expect(groups.map((g) => g.supplierName).sort()).toEqual(["", "DigiKey", "Voltaat"]);
    const text = whatsappText(
      groups.filter((g) => g.supplierName === "Voltaat"),
      "Order"
    );
    expect(text).toBe("Order\n\nVoltaat\n4 x Relay module (V-a)");
    expect(text).not.toMatch(/QAR|score|margin/i);
  });
  it("only picked products; csv has the picked rows", () => {
    const groups = buildOrderGroups(items, { b: 3 });
    expect(groups).toHaveLength(1);
    const csv = groupsCsv(groups).trim().split("\n");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain("ESP32");
    expect(csv[1]).toContain(",3,");
  });
});

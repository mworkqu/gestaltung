import { describe, expect, it } from "vitest";

import { cached, Lru, stableHash, stableStringify } from "./cache";

describe("stableHash", () => {
  it("does not depend on object key order (deeply)", () => {
    const a = { name: "Plant", features: ["solar"], nested: { x: 1, y: [{ b: 2, a: 1 }] } };
    const b = { nested: { y: [{ a: 1, b: 2 }], x: 1 }, features: ["solar"], name: "Plant" };
    expect(stableHash(a)).toBe(stableHash(b));
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("changes when any value changes", () => {
    const base = { name: "Plant", power: "usb", outputs: ["led"] };
    const h = stableHash(base);
    expect(stableHash({ ...base, power: "battery_usb" })).not.toBe(h);
    expect(stableHash({ ...base, name: "plant" })).not.toBe(h);
    expect(stableHash({ ...base, outputs: ["led", "screen"] })).not.toBe(h);
  });

  it("keeps array order (a list is not a set)", () => {
    expect(stableHash({ a: [1, 2] })).not.toBe(stableHash({ a: [2, 1] }));
  });

  it("treats undefined fields as absent, null as a value", () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
    expect(stableHash({ a: 1, b: null })).not.toBe(stableHash({ a: 1 }));
  });

  it("is deterministic and compact, with Arabic text", () => {
    const v = { idea: "جهاز صغير يسقي النبتة" };
    expect(stableHash(v)).toBe(stableHash({ ...v }));
    expect(stableHash(v)).toMatch(/^[0-9a-z]{16,}$/);
  });

  it("separates values that only differ in string boundaries", () => {
    expect(stableHash({ a: "x", b: "yz" })).not.toBe(stableHash({ a: "xy", b: "z" }));
  });
});

describe("Lru", () => {
  it("counts hits and misses", () => {
    const c = new Lru<number>(3);
    expect(c.get("a")).toBeUndefined();
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect([c.hits, c.misses]).toEqual([1, 1]);
  });

  it("drops the least recently used entry first", () => {
    const c = new Lru<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now the freshest
    c.set("c", 3); // evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("expires entries after the time to live", () => {
    let t = 0;
    const c = new Lru<number>(5, 1000, () => t);
    c.set("a", 1);
    t = 999;
    expect(c.get("a")).toBe(1);
    t = 2500;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });
});

describe("cached", () => {
  it("runs once for a repeated key, again for a new key", async () => {
    const c = new Lru<string>(5);
    let calls = 0;
    const make = (v: string) => async () => {
      calls++;
      return v;
    };
    expect(await cached(c, "k1", make("one"))).toBe("one");
    expect(await cached(c, "k1", make("other"))).toBe("one");
    expect(calls).toBe(1);
    expect(await cached(c, "k2", make("two"))).toBe("two");
    expect(calls).toBe(2);
  });

  it("does not keep a result `keep` refuses", async () => {
    const c = new Lru<number>(5);
    let calls = 0;
    const make = async () => ++calls;
    await cached(c, "k", make, (v) => v > 1);
    await cached(c, "k", make, (v) => v > 1);
    expect(calls).toBe(2);
    expect(await cached(c, "k", make, (v) => v > 1)).toBe(2);
  });

  it("without a cache simply calls through", async () => {
    let calls = 0;
    await cached(null, "k", async () => ++calls);
    await cached(undefined, "k", async () => ++calls);
    expect(calls).toBe(2);
  });
});

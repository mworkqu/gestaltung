import { beforeEach, describe, expect, it, vi } from "vitest";

import { Lru } from "@/lib/studio/cache";
import { DEFAULT_SPEC, type ProductSpec } from "../schema";
import { pickKey, specKey, type AiCache } from "./cache";
import { fakeModel } from "./fake-model";
import { runPick, type PickIndexEntry } from "./pick";
import { runSpecChat } from "./spec";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const INDEX: PickIndexEntry[] = [
  { id: "esp32_devkit", category: "mcu", name: "ESP32 DevKit" },
  { id: "dht22", category: "sensor", name: "DHT22" },
  { id: "led_5mm", category: "output", name: "LED 5 mm" },
];
const spec = (over: Partial<ProductSpec> = {}): ProductSpec => ({ ...DEFAULT_SPEC, ...over });
const PICKED = { components: [{ partId: "esp32_devkit", label: "Brain" }, { partId: "dht22", label: "Sensor" }], reasons: [] };
const SPEC = {
  name: "Plant buddy",
  oneLine: "Tells you when the plant needs water.",
  use: "desk",
  power: "usb",
  environment: "indoor",
  features: [],
  inputs: [],
  outputs: ["led"],
  sizeHint: "palm",
  style: "rounded",
  quantity: 1,
};

describe("runPick with a cache", () => {
  it("asks the model once for the same spec, and again for a changed spec", async () => {
    const cache: AiCache = new Lru<unknown>(10);
    const m = fakeModel([PICKED, PICKED]);
    const run = (s: ProductSpec) => runPick({ call: m.call, spec: s, index: INDEX, locale: "en", cache });
    const a = await run(spec());
    const b = await run(spec());
    expect(m.prompts).toHaveLength(1);
    // The same answer, flagged as a cache hit (the route reads that: nothing was
    // consumed on this turn, so the charge telemetry records no provider spend).
    expect(b).toEqual({ ...a, cached: true });
    await run(spec({ power: "battery_usb" }));
    expect(m.prompts).toHaveLength(2);
    // Back to the first card: cached, no third call.
    await run(spec());
    expect(m.prompts).toHaveLength(2);
  });

  it("does not keep a safe default (the next run asks the model again)", async () => {
    const cache: AiCache = new Lru<unknown>(10);
    const bad = { components: [{ partId: "nope", label: "x" }] };
    const m = fakeModel([bad, bad, PICKED]);
    const first = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en", cache });
    expect(first.ok && first.source).toBe("default");
    const second = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en", cache });
    expect(second.ok && second.source).toBe("model");
  });

  it("without a cache every run calls the model (the default for tests and callers)", async () => {
    const m = fakeModel([PICKED, PICKED]);
    await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en" });
    await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en" });
    expect(m.prompts).toHaveLength(2);
  });

  it("a hit is a copy: editing it does not change the stored answer", async () => {
    const cache: AiCache = new Lru<unknown>(10);
    const m = fakeModel([PICKED]);
    await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en", cache });
    const hit = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en", cache });
    if (hit.ok) hit.value.components.length = 0;
    const again = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en", cache });
    expect(again.ok && again.value.components.length).toBeGreaterThan(0);
  });

  it("keys: spec key order does not matter, library and language do", () => {
    const s = spec();
    const reordered = Object.fromEntries(Object.entries(s).reverse());
    expect(pickKey({ spec: s, locale: "en", index: INDEX })).toBe(pickKey({ spec: reordered, locale: "en", index: INDEX }));
    expect(pickKey({ spec: s, locale: "ar", index: INDEX })).not.toBe(pickKey({ spec: s, locale: "en", index: INDEX }));
    expect(pickKey({ spec: s, locale: "en", index: INDEX.slice(1) })).not.toBe(pickKey({ spec: s, locale: "en", index: INDEX }));
  });
});

describe("runSpecChat with a cache", () => {
  it("answers the same chat + card from the cache, a new message from the model", async () => {
    const cache: AiCache = new Lru<unknown>(10);
    const m = fakeModel([{ spec: SPEC }, { spec: { ...SPEC, name: "Solar buddy" } }]);
    const run = (idea: string, messages: { role: "user" | "assistant"; text: string }[] = []) =>
      runSpecChat({ call: m.call, idea, messages, locale: "en", cache });
    const a = await run("a plant watering monitor for my desk");
    const b = await run("a plant watering monitor for my desk");
    expect(m.prompts).toHaveLength(1);
    expect(b).toEqual({ ...a, cached: true });
    await run("a plant watering monitor for my desk", [{ role: "user", text: "make it solar" }]);
    expect(m.prompts).toHaveLength(2);
  });

  it("our own vague-idea question never reaches the model or the cache", async () => {
    const cache: AiCache = new Lru<unknown>(10);
    const m = fakeModel([]);
    const r = await runSpecChat({ call: m.call, idea: "something with Arduino", messages: [], locale: "en", cache });
    expect(r.ok && r.source).toBe("rules");
    expect(m.prompts).toHaveLength(0);
    expect((cache as Lru<unknown>).size).toBe(0);
  });

  it("spec keys ignore message key order and choices", () => {
    const a = specKey({ idea: "x", locale: "en", messages: [{ role: "user", text: "hi" }] });
    const b = specKey({ idea: "x", locale: "en", messages: [{ text: "hi", role: "user" }] });
    expect(a).toBe(b);
    expect(specKey({ idea: "x", locale: "en", messages: [{ role: "user", text: "hi" }], current: spec() })).not.toBe(a);
  });
});

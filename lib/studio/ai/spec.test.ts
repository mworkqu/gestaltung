import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "@/lib/prototyping/providers/types";
import { fakeModel } from "./fake-model";
import { cleanMessages, questionsAsked, runSpecChat } from "./spec";
import type { ChatMessage } from "./prompts";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const SPEC = {
  name: "Plant buddy",
  oneLine: "Tells you when the plant needs water.",
  use: "desk",
  power: "battery_usb",
  environment: "indoor",
  features: ["soil moisture"],
  inputs: ["button"],
  outputs: ["led"],
  sizeHint: "palm",
  style: "rounded",
  quantity: 1,
};

const asked = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => [
    { role: "assistant" as const, text: `Question ${i + 1}?`, choices: ["A", "B"] },
    { role: "user" as const, text: "A" },
  ]).flat();

describe("runSpecChat", () => {
  it("returns a question with de-duplicated choices", async () => {
    const m = fakeModel([{ question: "Where will it live?", choices: ["On a desk", "Outside", "On a desk"] }]);
    const r = await runSpecChat({ call: m.call, idea: "a plant monitor", messages: [], locale: "en" });
    expect(r.ok && r.value).toEqual({ kind: "question", question: "Where will it live?", choices: ["On a desk", "Outside"] });
    expect(m.temperatures[0]).toBe(0.2);
  });

  it("cuts long questions to 140 and choices to 40 characters", async () => {
    const m = fakeModel([{ question: "Q".repeat(300), choices: ["x".repeat(80), "short"] }]);
    const r = await runSpecChat({ call: m.call, idea: "idea", messages: [], locale: "en" });
    if (!r.ok || r.value.kind !== "question") throw new Error("expected a question");
    expect(r.value.question.length).toBe(140);
    expect(r.value.choices[0].length).toBe(40);
  });

  it("returns a valid spec, quantity always 1, enums clamped", async () => {
    const m = fakeModel([{ spec: { ...SPEC, quantity: 50, style: "Soft Tech", power: "nuclear" } }]);
    const r = await runSpecChat({ call: m.call, idea: "idea", messages: asked(2), locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected a spec");
    expect(r.value.spec.quantity).toBe(1);
    expect(r.value.spec.style).toBe("soft_tech");
    expect(r.value.spec.power).toBe("usb");
    expect(r.source).toBe("model");
    expect(r.clampLog.length).toBeGreaterThan(0);
  });

  it("invalid → retries with the problem → valid", async () => {
    const m = fakeModel([
      { question: "Only one choice?", choices: ["yes"] },
      { question: "Indoor or outdoor?", choices: ["Indoor", "Outdoor"] },
    ]);
    const r = await runSpecChat({ call: m.call, idea: "idea", messages: [], locale: "en" });
    expect(r.ok && r.value.kind).toBe("question");
    expect(m.prompts).toHaveLength(2);
    expect(m.prompts[1]).toContain("offer 2–4 short choices");
  });

  it("forces the spec after 4 questions (a question is rejected, then 'Return the spec now')", async () => {
    const m = fakeModel([{ question: "One more?", choices: ["a", "b"] }, { spec: SPEC }]);
    const r = await runSpecChat({ call: m.call, idea: "idea", messages: asked(4), locale: "en" });
    expect(r.ok && r.value.kind).toBe("spec");
    expect(m.prompts[0]).toContain("Return the spec now.");
    expect(m.prompts[1]).toContain("return the spec now, not a question");
  });

  it("invalid twice → safe default spec from the idea text", async () => {
    const m = fakeModel(["nonsense", { nothing: true }]);
    const r = await runSpecChat({ call: m.call, idea: "Smart plant watering monitor for my desk", messages: [], locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected default spec");
    expect(r.source).toBe("default");
    expect(r.value.spec.name).toBe("Smart plant watering monitor for");
    expect(r.value.spec.quantity).toBe(1);
  });

  it("provider down → error, no default", async () => {
    const m = fakeModel([new ProviderError("unavailable", "503")]);
    const r = await runSpecChat({ call: m.call, idea: "x", messages: [], locale: "en" });
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("never puts the clamp log in the turn itself", async () => {
    const m = fakeModel([{ spec: { ...SPEC, quantity: 9 } }]);
    const r = await runSpecChat({ call: m.call, idea: "x", messages: [], locale: "en" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.clampLog.length).toBeGreaterThan(0);
    const body = JSON.stringify(r.value);
    expect(body).not.toContain('"path"');
    expect(body).toContain('"quantity":1');
  });
});

describe("cleanMessages / questionsAsked", () => {
  it("keeps the last 16 valid messages, 1,500 characters each", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", text: "x".repeat(2000) }));
    const out = cleanMessages([...many, { role: "system", text: "hack" }, "junk"]);
    expect(out).toHaveLength(16);
    expect(out[0].text.length).toBe(1500);
    expect(questionsAsked(out)).toBe(8);
  });
});

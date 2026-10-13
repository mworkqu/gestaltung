import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "@/lib/prototyping/providers/types";
import { fakeModel } from "./fake-model";
import { cleanMessages, IDENTITY_REPLY, questionsAsked, runSpecChat } from "./spec";
import { clampSpec, type ProductSpec } from "../schema";
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
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: [], locale: "en" });
    if (!r.ok || r.value.kind !== "question") throw new Error("expected a question");
    expect(r.value.question.length).toBe(140);
    expect(r.value.choices[0].length).toBe(40);
  });

  it("returns a valid spec, quantity always 1, enums clamped", async () => {
    const m = fakeModel([{ spec: { ...SPEC, quantity: 50, style: "Soft Tech", power: "nuclear" } }]);
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: asked(2), locale: "en" });
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
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: [], locale: "en" });
    expect(r.ok && r.value.kind).toBe("question");
    expect(m.prompts).toHaveLength(2);
    expect(m.prompts[1]).toContain("offer 2–4 short choices");
  });

  it("forces the spec after 4 questions (a question is rejected, then 'Return the spec now')", async () => {
    const m = fakeModel([{ question: "One more?", choices: ["a", "b"] }, { spec: SPEC }]);
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: asked(4), locale: "en" });
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
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: [], locale: "en" });
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("never puts the clamp log in the turn itself", async () => {
    const m = fakeModel([{ spec: { ...SPEC, quantity: 9 } }]);
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: [], locale: "en" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.clampLog.length).toBeGreaterThan(0);
    const body = JSON.stringify(r.value);
    expect(body).not.toContain('"path"');
    expect(body).toContain('"quantity":1');
  });
});

describe("runSpecChat once the card exists (Part A: the chat answers like a person)", () => {
  const card: ProductSpec = clampSpec({ ...SPEC, power: "usb", name: "Robotic Arm", oneLine: "A desktop arm that moves things." });
  const chat = (text: string): ChatMessage[] => [{ role: "user", text }];
  const run = (answers: unknown[], text: string, locale: "en" | "ar" = "en") => {
    const m = fakeModel(answers);
    return { m, r: runSpecChat({ call: m.call, idea: "robotic arm", messages: chat(text), locale, current: card }) };
  };

  it("a change: the new spec, what changed, and a reply that says so", async () => {
    const { m, r } = run(
      [{ reply: "Done — it now runs on a battery you can recharge.", changed: ["Now battery powered"], spec: { ...card, power: "battery_usb" } }],
      "make it run on a battery",
    );
    const out = await r;
    if (!out.ok || out.value.kind !== "reply" || !out.value.spec) throw new Error("expected a reply with a spec");
    expect(out.value.spec.power).toBe("battery_usb");
    expect(out.value.changed).toEqual(["Now battery powered"]);
    expect(out.value.reply).toContain("battery");
    expect(m.prompts[0]).toContain("Current spec:");
    expect(m.prompts[0]).toContain("make it run on a battery");
  });

  it("a question about a reference product: an answer, no spec, the card untouched", async () => {
    const { r } = run(
      [{ reply: "A UR10 is an industrial robot arm with a 1.3 m reach. Yours is a desktop arm that moves like it, with hobby servos.", changed: [] }],
      "do you know what is ur10",
    );
    const out = await r;
    expect(out.ok && out.value).toEqual({
      kind: "reply",
      reply: "A UR10 is an industrial robot arm with a 1.3 m reach. Yours is a desktop arm that moves like it, with hobby servos.",
      changed: [],
    });
  });

  it("off-topic / who made you: the assistant line, never the provider", async () => {
    const { r } = run([{ reply: "I was made by Google — I'm Gemini.", changed: [] }], "who create you?");
    const out = await r;
    if (!out.ok || out.value.kind !== "reply") throw new Error("expected a reply");
    expect(out.value.reply).toBe(IDENTITY_REPLY.en);
    expect(out.value.reply).not.toMatch(/gemini|google/i);
    expect(out.value.spec).toBeUndefined();
  });

  it("never claims to be human (Arabic too)", async () => {
    const { r } = run([{ reply: "أنا إنسان مثلك.", changed: [] }], "هل أنت إنسان أم برنامج", "ar");
    const out = await r;
    expect(out.ok && out.value.kind === "reply" && out.value.reply).toBe(IDENTITY_REPLY.ar);
  });

  it("a rude message the guard lets through: a calm reply, the card unchanged", async () => {
    const { m, r } = run([{ reply: "Sorry it's not right yet — tell me what to change.", changed: [] }], "this design is rubbish honestly");
    const out = await r;
    expect(out.ok && out.value).toEqual({ kind: "reply", reply: "Sorry it's not right yet — tell me what to change.", changed: [] });
    expect(m.prompts).toHaveLength(1);
  });

  it("a spec equal to the card is no change: no spec, no changed labels", async () => {
    const { r } = run([{ reply: "It already sits on a desk.", changed: ["Sits on a desk"], spec: { ...card } }], "put it on a desk");
    const out = await r;
    expect(out.ok && out.value).toEqual({ kind: "reply", reply: "It already sits on a desk.", changed: [] });
  });

  it("a reply is always required: a bare spec is retried with the problem", async () => {
    const { m, r } = run(
      [{ spec: { ...card, power: "battery_usb" } }, { reply: "Now on a battery.", changed: ["Battery"], spec: { ...card, power: "battery_usb" } }],
      "battery please",
    );
    const out = await r;
    expect(out.ok && out.value.kind).toBe("reply");
    expect(m.prompts[1]).toContain("reply is required");
  });

  it("cuts the reply to 220 characters and the labels to 4 × 40", async () => {
    const { r } = run(
      [{ reply: "word ".repeat(80), changed: ["a".repeat(60), "b", "B", "c", "d", "e"], spec: { ...card, power: "battery_usb" } }],
      "battery",
    );
    const out = await r;
    if (!out.ok || out.value.kind !== "reply") throw new Error("expected a reply");
    expect(out.value.reply.length).toBeLessThanOrEqual(220);
    expect(out.value.changed).toEqual(["a".repeat(40), "b", "c", "d"]);
  });
});

describe("scope honesty on the first card", () => {
  it("a UR10 idea: the small version on the card, a scale note and a reply that says so", async () => {
    const m = fakeModel([
      {
        reply: "A real UR10 is an industrial arm (1.3 m reach, 10 kg). We can build a desktop arm that moves like it, about 30–40 cm, with hobby servos.",
        spec: {
          ...SPEC,
          name: "Desktop robot arm",
          oneLine: "A desktop arm that moves like a UR10, about 30–40 cm, with hobby servos.",
          scaleNote: "A real UR10 reaches 1.3 m; this is a 30–40 cm desktop version.",
        },
      },
    ]);
    const r = await runSpecChat({ call: m.call, idea: "big robotic arm like ur10", messages: asked(1), locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected a spec");
    expect(r.value.reply).toMatch(/UR10/);
    expect(r.value.spec.scaleNote).toBe("A real UR10 reaches 1.3 m; this is a 30–40 cm desktop version.");
    expect(r.value.spec.oneLine).toMatch(/desktop/);
  });

  it("an ordinary idea has no scale note and no reply", async () => {
    const m = fakeModel([{ spec: SPEC }]);
    const r = await runSpecChat({ call: m.call, idea: "a desk lamp", messages: asked(1), locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected a spec");
    expect(r.value.reply).toBeUndefined();
    expect(r.value.spec.scaleNote).toBeUndefined();
  });

  it("the scale note is cut to 140 characters", () => {
    expect(clampSpec({ ...SPEC, scaleNote: "x".repeat(300) }).scaleNote?.length).toBe(140);
    expect(clampSpec({ ...SPEC, scaleNote: "   " }).scaleNote).toBeUndefined();
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

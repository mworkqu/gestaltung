import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SPEC, ProductSpecSchema, type ProductSpec } from "../schema";
import { fakeModel } from "./fake-model";
import { enforcePick, specParts } from "./pick";
import { runSpecChat } from "./spec";
import {
  actuatorFor, chatGuardKind, chatGuardTurn, draftSpec, GUARD_REPLY, guardSpec, isVague, powerSaid, userTexts, VAGUE_QUESTION,
  vagueTurn,
} from "./spec-guards";
import { libraryIndexForAI } from "../library";

// W3 fixtures: the owner's walkthrough ideas. The model is ALWAYS a scripted fake
// (fake-model.ts): these tests never reach a real AI provider.

const PLANT = "automatic small plant watering monitor";
const VAGUE = ["something with Arduino", "Build something new with Arduino", "شيء باستخدام الأردوينو"];
const WEARABLE = "a wristband that buzzes when I sit too long";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** What a lazy model answers for the plant idea: no pump, generic desk, a lone battery. */
const LAZY_PLANT: ProductSpec = {
  ...DEFAULT_SPEC,
  name: "Plant monitor",
  oneLine: "Checks the soil.",
  use: "desk",
  power: "battery",
  features: ["soil moisture"],
  outputs: ["led"],
  sizeHint: "desk",
};

describe("vagueness", () => {
  it.each(VAGUE)("'%s' states no function", (idea) => {
    expect(isVague(userTexts(idea, []))).toBe(true);
  });

  it.each([PLANT, WEARABLE, "A little desk friend that lights up when I walk in", "a robot", "رفيق صغير للمكتب يضيء عندما أدخل"])(
    "'%s' is clear enough",
    (idea) => {
      expect(isVague(userTexts(idea, []))).toBe(false);
    },
  );

  it("asks ONE short question with 3–4 chips, never echoing the idea", () => {
    const turn = vagueTurn("Build something new with Arduino", [], "en");
    expect(turn).toEqual({ kind: "question", ...VAGUE_QUESTION.en });
    expect(turn!.choices.length).toBeGreaterThanOrEqual(3);
    expect(turn!.choices.length).toBeLessThanOrEqual(4);
    expect(turn!.question.toLowerCase()).not.toContain("arduino");
    expect(vagueTurn("شيء باستخدام الأردوينو", [], "ar")?.question).toBe(VAGUE_QUESTION.ar.question);
  });

  it("asks it once: a still-vague answer goes to the model", () => {
    const asked = [
      { role: "assistant" as const, text: VAGUE_QUESTION.en.question },
      { role: "user" as const, text: "something cool" },
    ];
    expect(vagueTurn("something with Arduino", asked, "en")).toBeNull();
  });

  it("a chip answer is no longer vague", () => {
    const answered = [
      { role: "assistant" as const, text: VAGUE_QUESTION.en.question },
      { role: "user" as const, text: VAGUE_QUESTION.en.choices[0] },
    ];
    expect(isVague(userTexts("something with Arduino", answered))).toBe(false);
  });
});

describe("function words, power, placement", () => {
  it("plant fixture: pump + one matching power + soil placement, even when the model drops them", () => {
    const { spec } = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" });
    expect(ProductSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.outputs).toContain("pump");
    expect(spec.outputs).toContain("led"); // the model's own choices are kept
    expect(spec.features.some((f) => /pump/i.test(f))).toBe(true);
    expect(spec.features.some((f) => /soil/i.test(f))).toBe(true);
    expect(spec.power).toBe("usb"); // a lone battery cannot keep a pump going
    expect(spec.placement).toBe("plant_soil");
    expect(spec.use).toBe("desk");
    expect(spec.sizeHint).toBe("palm");
  });

  it("plant fixture in Arabic", () => {
    const { spec } = guardSpec(LAZY_PLANT, { idea: "جهاز صغير يسقي النبتة تلقائياً", messages: [], locale: "ar" });
    expect(spec.outputs).toContain("pump");
    expect(spec.features).toContain("مضخة ماء صغيرة");
    expect(spec.placement).toBe("plant_soil");
  });

  it("'watering reminder' without automatic gets no pump", () => {
    expect(actuatorFor(userTexts("a plant watering reminder", []))).toBeNull();
    expect(actuatorFor(userTexts("waterproof light", []))).toBeNull();
    expect(actuatorFor(userTexts("plant watering monitor", [{ role: "user", text: "Automatically" }]))).toBe("pump");
  });

  it("a valve gets a relay and a wall adapter", () => {
    const { spec } = guardSpec(LAZY_PLANT, { idea: "garden watering with a solenoid valve", messages: [], locale: "en" });
    expect(spec.outputs).toContain("relay");
    expect(spec.outputs).not.toContain("pump");
    expect(spec.power).toBe("mains_adapter");
    expect(spec.use).toBe("outdoor");
    expect(spec.environment).toBe("outdoor");
  });

  it("wearable fixture: on the wrist, pocket-sized, battery, buzzer kept", () => {
    const model: ProductSpec = { ...DEFAULT_SPEC, name: "Sit timer", use: "desk", power: "usb", outputs: [], sizeHint: "palm" };
    const { spec } = guardSpec(model, { idea: WEARABLE, messages: [], locale: "en" });
    expect(spec.use).toBe("wearable");
    expect(spec.placement).toBe("on_wrist");
    expect(spec.sizeHint).toBe("pocket");
    expect(spec.power).toBe("battery_usb");
    expect(spec.outputs).toContain("buzzer");
  });

  it("a necklace is worn on the body", () => {
    const { spec } = guardSpec(DEFAULT_SPEC, { idea: "a glowing necklace for concerts", messages: [], locale: "en" });
    expect(spec.placement).toBe("on_body");
    expect(spec.outputs).toContain("led");
  });

  it("the latest power word wins, and solar is a charged battery", () => {
    expect(powerSaid(["plug it in", "make it solar"])).toBe("solar");
    expect(powerSaid(["make it solar", "actually plug it into the wall socket"])).toBe("mains");
    const solar = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [{ role: "user", text: "make it solar" }], locale: "en" }).spec;
    expect(solar.power).toBe("battery_usb");
    expect(solar.features.some((f) => /solar/i.test(f))).toBe(true);
    expect(solar.outputs).toContain("pump");
    const back = guardSpec(solar, {
      idea: PLANT,
      messages: [
        { role: "user", text: "make it solar" },
        { role: "user", text: "no, plug it in" },
      ],
      locale: "en",
    }).spec;
    expect(back.power).toBe("mains_adapter");
    expect(back.features.some((f) => /solar/i.test(f))).toBe(false);
  });

  it("a refinement can take the pump out again", () => {
    const withPump = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" }).spec;
    const without = guardSpec(withPump, { idea: PLANT, messages: [{ role: "user", text: "no pump please" }], locale: "en" }).spec;
    expect(without.outputs).not.toContain("pump");
  });

  it("'add a pump' adds one to any idea", () => {
    const { spec } = guardSpec({ ...DEFAULT_SPEC, outputs: ["screen"] }, {
      idea: "desk fountain",
      messages: [{ role: "user", text: "add a pump" }],
      locale: "en",
    });
    expect(spec.outputs).toContain("pump");
  });

  it("never more than the feature limit", () => {
    const full = { ...LAZY_PLANT, features: Array.from({ length: 8 }, (_, i) => `feature ${i}`) };
    expect(guardSpec(full, { idea: PLANT, messages: [], locale: "en" }).spec.features).toHaveLength(8);
  });
});

describe("draftSpec (the live card before the AI answers)", () => {
  it("fills what the plant idea already says", () => {
    const d = draftSpec(PLANT, [], "en");
    expect([...d.touched].sort()).toEqual(["does", "place", "power", "senses", "size"]);
    expect(d.spec.outputs).toEqual(["pump"]);
    expect(d.spec.placement).toBe("plant_soil");
  });

  it("knows nothing about a vague idea", () => {
    expect(draftSpec("something with Arduino", [], "en").touched.size).toBe(0);
  });
});

describe("runSpecChat with the fixtures (scripted fake model)", () => {
  it("plant: the model's lazy spec comes back with a pump, soil placement and USB power", async () => {
    const m = fakeModel([{ spec: LAZY_PLANT }]);
    const r = await runSpecChat({ call: m.call, idea: PLANT, messages: [], locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected a spec");
    expect(r.value.spec.outputs).toContain("pump");
    expect(r.value.spec.placement).toBe("plant_soil");
    expect(r.value.spec.power).toBe("usb");
    expect(m.prompts[0]).toContain(PLANT);
  });

  it.each(VAGUE)("'%s': one question with chips and NO model call", async (idea) => {
    const m = fakeModel([{ spec: { ...LAZY_PLANT, name: idea.slice(0, 40) } }]);
    const r = await runSpecChat({ call: m.call, idea, messages: [], locale: "en" });
    expect(r.ok && r.source).toBe("rules");
    expect(r.ok && r.value.kind).toBe("question");
    expect(m.prompts).toHaveLength(0);
  });

  it("wearable: worn on the wrist even when the model says desk", async () => {
    const m = fakeModel([{ spec: { ...DEFAULT_SPEC, name: "Sit timer", outputs: ["buzzer"] } }]);
    const r = await runSpecChat({ call: m.call, idea: WEARABLE, messages: [], locale: "en" });
    if (!r.ok || r.value.kind !== "spec") throw new Error("expected a spec");
    expect(r.value.spec.placement).toBe("on_wrist");
    expect(r.value.spec.power).toBe("battery_usb");
  });

  it("refinement: the current card is sent, a question is refused, the guards apply to the new spec", async () => {
    const current = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" }).spec;
    const m = fakeModel([
      { question: "Which panel?", choices: ["Small", "Big"] },
      { reply: "Done, it runs on the sun now.", spec: { ...current, power: "usb" }, changed: ["Now solar powered"] },
    ]);
    const r = await runSpecChat({ call: m.call, idea: PLANT, messages: [{ role: "user", text: "make it solar" }], locale: "en", current });
    if (!r.ok || r.value.kind !== "reply" || !r.value.spec) throw new Error("expected a reply with a spec");
    expect(m.prompts[0]).toContain("Current spec:");
    expect(m.prompts[0]).toContain("make it solar");
    expect(m.prompts[1]).toContain("reply is required");
    expect(r.value.spec.power).toBe("battery_usb"); // the visitor's word beats the model
    expect(r.value.spec.outputs).toContain("pump");
    expect(r.value.changed).toEqual(["Now solar powered"]);
  });

  it("refinement fallback keeps the current card (never a blank default) and still replies", async () => {
    const current = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" }).spec;
    const m = fakeModel(["nonsense", "still nonsense"]);
    const r = await runSpecChat({ call: m.call, idea: PLANT, messages: [{ role: "user", text: "add a buzzer" }], locale: "en", current });
    if (!r.ok || r.value.kind !== "reply" || !r.value.spec) throw new Error("expected a reply with a spec");
    expect(r.source).toBe("default");
    expect(r.value.reply).toBeTruthy();
    expect(r.value.spec.name).toBe(current.name);
    expect(r.value.spec.outputs).toEqual(expect.arrayContaining(["pump", "buzzer"]));
  });
});

describe("parts follow the spec", () => {
  it("a pump spec always gets the pump and the soil probe, whatever the model picked", () => {
    const spec = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" }).spec;
    expect(specParts(spec)).toEqual(["pump_5v", "soil_moisture_cap"]);
    const picked = enforcePick(
      { components: [{ partId: "esp32_devkit", label: "Brain" }, { partId: "led_5mm", label: "Light" }] },
      { spec, index: libraryIndexForAI(), locale: "en", log: [] },
    );
    const ids = picked.components.map((c) => c.partId);
    expect(ids).toContain("pump_5v");
    expect(ids).toContain("soil_moisture_cap");
    expect(ids.filter((id) => id === "esp32_devkit")).toHaveLength(1);
  });
});

describe("chat guard (Part A): no AI for greetings, thanks, insults, emoji or empty messages", () => {
  it.each([
    ["", "empty"],
    ["   ?? ...", "empty"],
    ["👍", "emoji"],
    ["😂😂 🔥", "emoji"],
    ["hi", "greeting"],
    ["Hello there!", "greeting"],
    ["heyyy", "greeting"],
    ["good morning", "greeting"],
    ["مرحبا", "greeting"],
    ["السلام عليكم", "greeting"],
    ["thanks!", "thanks"],
    ["thank you so much", "thanks"],
    ["شكراً", "thanks"],
    ["are you stupid", "insult"],
    ["you're useless", "insult"],
    ["hi idiot", "insult"],
    ["انت غبي", "insult"],
  ])("%j → %s", (text, kind) => {
    expect(chatGuardKind(text)).toBe(kind);
  });

  it.each(["do you know what is ur10", "who create you?", "make it solar", "how are you", "hi, add a buzzer", "123", "اجعله يعمل بالطاقة الشمسية"])(
    "%j goes to the model",
    (text) => {
      expect(chatGuardKind(text)).toBeNull();
    },
  );

  it("with a card: a canned reply in the page language, nothing changed", () => {
    const messages = [{ role: "user" as const, text: "are you stupid" }];
    expect(chatGuardTurn(PLANT, messages, "en", true)).toEqual({ kind: "reply", reply: GUARD_REPLY.insult.en, changed: [] });
    expect(chatGuardTurn(PLANT, messages, "ar", true)).toEqual({ kind: "reply", reply: GUARD_REPLY.insult.ar, changed: [] });
  });

  it("before the card: the idea itself is checked and answered with the what-should-it-do chips", () => {
    const turn = chatGuardTurn("hello", [], "en", false);
    expect(turn?.kind).toBe("question");
    if (turn?.kind !== "question") return;
    expect(turn.question).toMatch(/what should your product do/i);
    expect(turn.choices).toEqual(VAGUE_QUESTION.en.choices);
  });

  it("every canned reply exists in both languages, short, without a provider name", () => {
    for (const r of Object.values(GUARD_REPLY)) {
      for (const text of [r.en, r.ar]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(220);
        expect(text).not.toMatch(/gemini|google/i);
      }
    }
  });

  it("runSpecChat answers a greeting without calling the model and leaves the card alone", async () => {
    const current = guardSpec(LAZY_PLANT, { idea: PLANT, messages: [], locale: "en" }).spec;
    const m = fakeModel([]);
    const r = await runSpecChat({ call: m.call, idea: PLANT, messages: [{ role: "user", text: "hi" }], locale: "en", current });
    expect(r.ok && r.source).toBe("rules");
    expect(r.ok && r.value).toEqual({ kind: "reply", reply: GUARD_REPLY.greeting.en, changed: [] });
    expect(m.prompts).toHaveLength(0);
  });
});

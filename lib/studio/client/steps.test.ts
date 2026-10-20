import { describe, expect, it } from "vitest";

import { DEFAULT_ENCLOSURE, DEFAULT_SPEC, emptyStudioDoc, type StudioDoc } from "../schema";
import {
  FLOW,
  answersFrom,
  cardRows,
  changedRows,
  forModel,
  factKeys,
  fileSlug,
  firstOpenStep,
  furthestStep,
  hasPassed,
  markPassed,
  passedAnswers,
  historyFrom,
  initialStep,
  looksLeftFromVersions,
  nextInstanceId,
  sameSpec,
  stepDone,
  stepFaded,
  stepFadedReasonKey,
  stepSettled,
  withLastStep,
} from "./steps";

const withParts = (): StudioDoc => ({
  ...emptyStudioDoc(),
  components: [{ partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "ESP32" }],
});

describe("studio flow", () => {
  it("lists the steps in order (Phase 2: Print parts after Enclosure)", () => {
    expect(FLOW).toEqual(["idea", "parts", "wiring", "enclosure", "print", "code", "make"]);
  });

  it("derives done from the doc", () => {
    expect(stepDone("idea", null)).toBe(false);
    expect(stepDone("idea", emptyStudioDoc())).toBe(true);
    expect(stepDone("parts", emptyStudioDoc())).toBe(false);
    expect(stepDone("parts", withParts())).toBe(true);
    const wired: StudioDoc = { ...withParts(), netlist: { nets: [{ name: "GND", pins: ["a.1", "b.1"] }] }, checks: [{ id: "x", ok: true, plain: "ok" }] };
    expect(stepDone("wiring", wired)).toBe(true);
    expect(stepDone("enclosure", { ...wired, enclosure: DEFAULT_ENCLOSURE })).toBe(true);
    expect(stepDone("make", { ...wired, enclosure: DEFAULT_ENCLOSURE })).toBe(false);
  });

  it("counts Code and Make as done only after they were passed", () => {
    const wired: StudioDoc = {
      ...withParts(),
      netlist: { nets: [{ name: "GND", pins: ["a.1", "b.1"] }] },
      checks: [{ id: "x", ok: true, plain: "ok" }],
      enclosure: DEFAULT_ENCLOSURE,
      mech: [{ id: "lid_0", template: "lid", params: {}, printable: { material: "PLA", estGrams: 10 } }],
      firmware: { board: "esp32", code: "void setup(){}" },
    };
    expect(stepDone("print", wired)).toBe(true);
    expect(stepDone("print", { ...wired, mech: [] })).toBe(false);
    // Everything before Code is done, but Code itself has not been visited yet.
    expect(stepDone("enclosure", wired)).toBe(true);
    expect(stepDone("code", wired)).toBe(false);
    expect(firstOpenStep(wired)).toBe(FLOW.indexOf("code"));
    const passed = { ...wired, answers: markPassed(wired.answers, "code") };
    expect(hasPassed("code", passed)).toBe(true);
    expect(stepDone("code", passed)).toBe(true);
    expect(stepDone("make", passed)).toBe(false);
    expect(firstOpenStep(passed)).toBe(FLOW.indexOf("make"));
    expect(markPassed(passed.answers, "code")).toBe(passed.answers);
    expect(passedAnswers({ idea: "x", "passed:code": "1" })).toEqual({ "passed:code": "1" });
    // The idea chat history ignores the marker.
    expect(historyFrom(passed.answers).messages).toEqual([]);
  });

  it("opens the first open step and honours a reachable ?step=", () => {
    expect(firstOpenStep(null)).toBe(0);
    expect(firstOpenStep(withParts())).toBe(2);
    expect(initialStep(withParts(), "parts")).toBe(1);
    expect(initialStep(withParts(), "make")).toBe(2); // not reachable yet
    expect(initialStep(withParts(), "nonsense")).toBe(2);
    // W1: no ?step= → the step the visitor was last on, when still reachable.
    expect(initialStep({ ...withParts(), lastStep: "parts" }, null)).toBe(1);
    expect(initialStep({ ...withParts(), lastStep: "idea" }, undefined)).toBe(0);
    expect(initialStep({ ...withParts(), lastStep: "make" }, null)).toBe(2);
    expect(initialStep({ ...withParts(), lastStep: "renamed-step" }, null)).toBe(2);
    expect(initialStep({ ...withParts(), lastStep: "idea" }, "parts")).toBe(1); // ?step= wins
    const d = withParts();
    expect(withLastStep(d, "parts").lastStep).toBe("parts");
    const same = { ...d, lastStep: "wiring" };
    expect(withLastStep(same, "wiring")).toBe(same);
    expect(furthestStep(withParts(), 4)).toBe(4);
    expect(furthestStep(withParts(), 0)).toBe(2);
  });

  it("compares specs regardless of list order", () => {
    const a = { ...DEFAULT_SPEC, outputs: ["led", "screen"] as const };
    const b = { ...DEFAULT_SPEC, outputs: ["screen", "led"] as const };
    expect(sameSpec({ ...a, outputs: [...a.outputs] }, { ...b, outputs: [...b.outputs] })).toBe(true);
    expect(sameSpec(DEFAULT_SPEC, { ...DEFAULT_SPEC, power: "battery" })).toBe(false);
    expect(sameSpec(null, DEFAULT_SPEC)).toBe(false);
  });

  it("keeps the chat as answers and reads it back", () => {
    const messages = [
      { role: "assistant" as const, text: "Where will it live?", choices: ["Desk", "Wall"] },
      { role: "user" as const, text: "Desk" },
    ];
    const answers = answersFrom("A desk lamp", messages);
    expect(answers).toEqual({ idea: "A desk lamp", "q:Where will it live?": "Desk" });
    expect(historyFrom(answers)).toEqual({
      idea: "A desk lamp",
      messages: [
        { role: "assistant", text: "Where will it live?" },
        { role: "user", text: "Desk" },
      ],
    });
    expect(historyFrom(undefined)).toEqual({ idea: "", messages: [] });
  });

  it("turns a spec into at most five plain facts", () => {
    const keys = factKeys({ ...DEFAULT_SPEC, outputs: ["screen", "led", "buzzer"], inputs: ["none", "button"] });
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(keys[0]).toBe("fact_use_desk");
    expect(keys).toContain("fact_power_usb");
    expect(keys).toContain("fact_out_screen");
  });

  it("small helpers", () => {
    expect(nextInstanceId("led_5mm", [{ instanceId: "led_5mm_1" }])).toBe("led_5mm_2");
    expect(looksLeftFromVersions(1)).toBe(2);
    expect(looksLeftFromVersions(3)).toBe(0);
    expect(looksLeftFromVersions(4)).toBe(2);
    expect(fileSlug("My Desk Lamp!")).toBe("my-desk-lamp");
    expect(fileSlug("مصباح")).toBe("design");
  });
});

describe("idea chat W3: refinements and the live card", () => {
  it("stores change requests typed after the card and reads them back with our note", () => {
    const messages = [
      { role: "assistant" as const, text: "Where will it live?", choices: ["Desk", "Wall"] },
      { role: "user" as const, text: "Desk" },
      { role: "user" as const, text: "make it solar" },
      { role: "assistant" as const, text: "", note: true as const },
      { role: "user" as const, text: "add a pump" },
      { role: "assistant" as const, text: "", note: true as const },
    ];
    const answers = answersFrom("A plant helper", messages);
    expect(answers).toEqual({ idea: "A plant helper", "q:Where will it live?": "Desk", "r:1": "make it solar", "r:2": "add a pump" });
    expect(historyFrom(answers).messages).toEqual([
      { role: "assistant", text: "Where will it live?" },
      { role: "user", text: "Desk" },
      { role: "user", text: "make it solar" },
      { role: "assistant", text: "", note: true },
      { role: "user", text: "add a pump" },
      { role: "assistant", text: "", note: true },
    ]);
    // The AI never sees our notes.
    expect(forModel(messages).some((m) => m.text === "")).toBe(false);
    expect(forModel(messages)).toHaveLength(4);
  });

  it("Part A: the assistant's replies are stored after the request they answer, read back, and sent to the AI", () => {
    const messages = [
      { role: "assistant" as const, text: "Where will it live?", choices: ["Desk", "Wall"] },
      { role: "user" as const, text: "Desk" },
      { role: "assistant" as const, text: "A real UR10 is 1.3 m; this is the desktop version.", note: true as const },
      { role: "user" as const, text: "what is ur10" },
      { role: "assistant" as const, text: "An industrial robot arm.", note: true as const },
      { role: "user" as const, text: "make it solar" },
      { role: "assistant" as const, text: "Done.", note: true as const, changed: ["Now solar powered"] },
    ];
    const answers = answersFrom("robot arm like ur10", messages);
    expect(answers).toEqual({
      idea: "robot arm like ur10",
      "q:Where will it live?": "Desk",
      "a:0": "A real UR10 is 1.3 m; this is the desktop version.",
      "r:1": "what is ur10",
      "a:1": "An industrial robot arm.",
      "r:2": "make it solar",
      "a:2": "Done.",
    });
    const back = historyFrom(answers).messages;
    expect(back.map((m) => m.text)).toEqual(messages.map((m) => m.text));
    expect(back.some((m) => "changed" in m)).toBe(false); // the chip is never stored
    expect(forModel(messages).filter((m) => m.role === "assistant")).toHaveLength(4);
    expect(forModel(messages).some((m) => "changed" in m || "note" in m)).toBe(false);
  });

  it("a spec straight after the idea: the first message is a change request", () => {
    expect(answersFrom("lamp", [{ role: "user", text: "make it red" }])).toEqual({ idea: "lamp", "r:1": "make it red" });
  });

  it("card rows: hints until known, placement before use, pump first", () => {
    const draft = cardRows({ ...DEFAULT_SPEC, outputs: ["pump"], placement: "plant_soil" }, new Set(["place", "does"] as const));
    expect(draft.map((r) => r.key)).toEqual(["fact_place_plant_soil", "fact_out_pump", null, null]);
    expect(draft.map((r) => r.hint)).toEqual(["card_hint_place", null, "card_hint_power", "card_hint_size"]);
    const full = cardRows({ ...DEFAULT_SPEC, outputs: ["pump", "led"], inputs: ["button"], placement: "plant_soil" }, "all");
    expect(full.every((r) => r.key)).toBe(true);
    expect(full.map((r) => r.key)).toContain("fact_in_button");
    expect(changedRows(draft, full)).toEqual(["does_1", "power", "input", "size"]);
  });

  it("facts use the placement when there is one", () => {
    expect(factKeys({ ...DEFAULT_SPEC, placement: "on_wrist" })[0]).toBe("fact_place_on_wrist");
  });
});

describe("faded steps (build class)", () => {
  const wiredDoc = (buildClass?: "mcu" | "logic" | "cad"): StudioDoc => ({
    ...withParts(),
    spec: { ...DEFAULT_SPEC, buildClass },
    netlist: { nets: [{ name: "GND", pins: ["a.1", "b.1"] }] },
    checks: [{ id: "x", ok: true, plain: "ok" }],
  });

  it("an mcu spec behaves exactly as before: nothing is faded", () => {
    for (const d of [wiredDoc("mcu"), wiredDoc(undefined)]) {
      for (const s of FLOW) expect(stepFaded(s, d)).toBe(false);
      expect(stepFadedReasonKey("code", d)).toBeNull();
      // Wiring done, the case not drawn yet -> still stops at Enclosure.
      expect(firstOpenStep(d)).toBe(FLOW.indexOf("enclosure"));
      const done = { ...d, enclosure: DEFAULT_ENCLOSURE, mech: [{ id: "lid_0", template: "lid", params: {}, printable: { material: "PLA", estGrams: 10 } }] } as StudioDoc;
      expect(firstOpenStep(done)).toBe(FLOW.indexOf("code")); // Code still has to be passed
      expect(stepSettled("code", done)).toBe(false);
    }
    expect(firstOpenStep(null)).toBe(0);
  });

  it("a logic spec reaches Make without the faded case, print or code", () => {
    const d = wiredDoc("logic");
    expect(stepFaded("enclosure", d)).toBe(true);
    expect(stepFaded("print", d)).toBe(true);
    expect(stepFaded("code", d)).toBe(true);
    expect(stepFaded("wiring", d)).toBe(false);
    expect(stepFadedReasonKey("code", d)).toBe("fadedLogic");
    expect(stepDone("code", d)).toBe(false); // faded is not done...
    expect(stepSettled("code", d)).toBe(true); // ...but it does not block
    expect(firstOpenStep(d)).toBe(FLOW.indexOf("make"));
    expect(furthestStep(d, 0)).toBe(FLOW.indexOf("make"));
    // Faded steps stay reachable: opening one is allowed (not disabled).
    expect(initialStep(d, "code")).toBe(FLOW.indexOf("code"));
  });

  it("a logic spec still needs the real steps before it", () => {
    const d = { ...wiredDoc("logic"), netlist: { nets: [] }, checks: [] };
    expect(firstOpenStep(d)).toBe(FLOW.indexOf("wiring"));
  });

  it("a cad spec fades wiring and code but keeps the case and print", () => {
    const d = { ...withParts(), spec: { ...DEFAULT_SPEC, buildClass: "cad" as const } };
    expect(stepFaded("wiring", d)).toBe(true);
    expect(stepFaded("code", d)).toBe(true);
    expect(stepFaded("enclosure", d)).toBe(false);
    expect(stepFadedReasonKey("wiring", d)).toBe("fadedCad");
    expect(firstOpenStep(d)).toBe(FLOW.indexOf("enclosure"));
  });
});

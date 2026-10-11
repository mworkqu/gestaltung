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

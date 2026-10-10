import { describe, expect, it } from "vitest";

import { DEFAULT_ENCLOSURE, DEFAULT_SPEC, emptyStudioDoc, type StudioDoc } from "../schema";
import {
  FLOW,
  answersFrom,
  factKeys,
  fileSlug,
  firstOpenStep,
  furthestStep,
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
  it("lists the Phase 1 steps in order", () => {
    expect(FLOW).toEqual(["idea", "parts", "wiring", "enclosure", "code", "make"]);
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

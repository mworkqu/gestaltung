import { describe, expect, it } from "vitest";

import {
  buildClassOf, classFor, CLASS_PLAN, fadedReasonKey, inferBuildClass, isFadedStep, needsController,
} from "./build-class";
import type { ProductSpec, Understanding } from "./schema";

// A card is mostly enums; only the words matter for inference, so the base spec
// is deliberately bland and each test supplies the sentence under test.
const understanding = (over: Partial<Understanding> = {}): Understanding => ({
  goal: "",
  howItWorks: "",
  controller: "",
  sensors: [],
  actuators: [],
  outputs: [],
  ...over,
});

const spec = (over: Partial<ProductSpec> = {}): ProductSpec => ({
  name: "Desk thing",
  oneLine: "A small desk device.",
  use: "desk",
  power: "usb",
  environment: "indoor",
  features: [],
  inputs: [],
  outputs: [],
  sizeHint: "desk",
  style: "rounded",
  quantity: 1,
  ...over,
});

describe("buildClassOf", () => {
  it("reads a card made before build classes existed as an mcu build", () => {
    expect(buildClassOf(spec())).toBe("mcu");
    expect(buildClassOf(null)).toBe("mcu");
    expect(buildClassOf(undefined)).toBe("mcu");
  });

  it("returns the stored class and never re-guesses it", () => {
    // The words say "logic", but the stored answer is what the user confirmed.
    expect(buildClassOf(spec({ buildClass: "cad", name: "De Morgan gate kit" }))).toBe("cad");
  });
});

describe("needsController", () => {
  it("only an mcu build runs firmware on a board", () => {
    expect(needsController(spec({ buildClass: "mcu" }))).toBe(true);
    expect(needsController(spec({ buildClass: "logic" }))).toBe(false);
    expect(needsController(spec({ buildClass: "cad" }))).toBe(false);
    // The default for an old card must stay true, or every existing build loses its board.
    expect(needsController(spec())).toBe(true);
  });
});

describe("inferBuildClass", () => {
  it("catches the case this was built for: TTL gates, no microcontroller", () => {
    // The owner's real transcript: the chat understood, the parts list did not.
    const s = spec({
      name: "De Morgan Logic Kit",
      oneLine: "Demonstrate De Morgan's laws using standard TTL logic gates on a breadboard.",
      features: ["AND gate (7408)", "OR gate (7432)", "NOT gate (7404)", "LED output indicators"],
      understanding: understanding({
        howItWorks:
          "The user toggles input switches connected to AND, OR and NOT logic gate ICs without any microcontroller.",
      }),
    });
    expect(inferBuildClass(s)).toBe("logic");
    expect(classFor(s)).toBe("logic");
  });

  it("catches a bare 7400-series part number with no other hint", () => {
    expect(inferBuildClass(spec({ oneLine: "I need a 7408 and a 7432 wired up." }))).toBe("logic");
    expect(inferBuildClass(spec({ oneLine: "Using 74HC00 and 74LS86 chips." }))).toBe("logic");
  });

  it("catches a plain refusal of a microcontroller", () => {
    expect(inferBuildClass(spec({ oneLine: "A truth table demo with no microcontroller." }))).toBe("logic");
  });

  it("reads Arabic too", () => {
    expect(inferBuildClass(spec({ oneLine: "بوابات منطقية مع جدول الحقيقة" }))).toBe("logic");
  });

  it("sends a print-only idea to cad", () => {
    const s = spec({ oneLine: "A 3d printed bracket, no electronics.", sizeHint: "palm" });
    expect(inferBuildClass(s)).toBe("cad");
  });

  it("says nothing about an ordinary build", () => {
    const s = spec({
      name: "Plant monitor",
      oneLine: "Watches the soil and beeps when the pot is dry.",
      understanding: understanding({ controller: "Arduino Uno", sensors: [{ name: "Soil moisture sensor", count: 1 }] }),
    });
    expect(inferBuildClass(s)).toBeNull();
    expect(classFor(s)).toBe("mcu");
  });

  it("never strips the board off a build that moves something", () => {
    // "no microcontroller" next to a servo is a contradiction; the mover wins,
    // because guessing "logic" here would leave the servo with nothing to drive it.
    const s = spec({
      oneLine: "A gate opener with no microcontroller, using logic gates.",
      actuators: [{ kind: "servo", count: 1, load: "light" }],
    });
    expect(inferBuildClass(s)).toBeNull();
    expect(classFor(s)).toBe("mcu");
  });

  it("never strips wiring off a build that drives anything (the 'holder with an LED' trap)", () => {
    // /holder/ matches, but an LED still has to be wired and driven. "cad"
    // would fade BOTH wiring and code away, so electrically-live cards are out.
    expect(inferBuildClass(spec({ name: "Phone holder", oneLine: "A desk holder with a status LED.", outputs: ["led"] }))).toBeNull();
    expect(inferBuildClass(spec({ oneLine: "A lamp with no microcontroller.", outputs: ["led"] }))).toBeNull();
    expect(inferBuildClass(spec({ oneLine: "A 3d printed bracket.", inputs: ["button"] }))).toBeNull();
  });

  it("does not fire on 'and gate' buried inside another word", () => {
    expect(inferBuildClass(spec({ oneLine: "A command gateway box for the office." }))).toBeNull();
  });

  it("never strips the board off a sensing build that merely says 'flip-flop'", () => {
    // In the picker a false "logic" is the expensive guess: it deletes the MCU.
    // A gate kit's only inputs are switches and it has no screen.
    const sensing = spec({
      oneLine: "A soil monitor; the latch behaves like a flip-flop.",
      understanding: understanding({
        controller: "Arduino Uno",
        sensors: [{ name: "Soil moisture sensor", count: 1 }],
      }),
    });
    expect(inferBuildClass(sensing)).toBeNull();

    const screened = spec({
      oneLine: "Shows a truth table on the display.",
      outputs: ["screen"],
    });
    expect(inferBuildClass(screened)).toBeNull();
  });

  it("still reads a real gate kit, whose only inputs are switches", () => {
    const kit = spec({
      name: "De Morgan Logic Kit",
      oneLine: "Demonstrate De Morgan's laws with 7408 and 7432 gates.",
      outputs: ["led"],
      inputs: ["button"],
      understanding: understanding({
        controller: "",
        sensors: [{ name: "Toggle switches", count: 2 }],
        outputs: [{ name: "LEDs", count: 3 }],
      }),
    });
    expect(inferBuildClass(kit)).toBe("logic");
  });

  it("a stored class always beats the words", () => {
    const s = spec({ buildClass: "mcu", oneLine: "7408 and 7432 logic gates, no microcontroller" });
    expect(classFor(s)).toBe("mcu");
  });
});

describe("faded steps", () => {
  it("a logic build leads with wiring and fades print, enclosure and code", () => {
    const s = spec({ buildClass: "logic" });
    expect(CLASS_PLAN.logic.lead).toBe("wiring");
    expect(isFadedStep(s, "wiring")).toBe(false);
    expect(isFadedStep(s, "code")).toBe(true);
    expect(isFadedStep(s, "print")).toBe(true);
    // The case belongs to the print deliverable, so it fades with it.
    expect(isFadedStep(s, "enclosure")).toBe(true);
  });

  it("a cad build leads with print and fades wiring and code", () => {
    const s = spec({ buildClass: "cad" });
    expect(isFadedStep(s, "print")).toBe(false);
    expect(isFadedStep(s, "enclosure")).toBe(false);
    expect(isFadedStep(s, "wiring")).toBe(true);
    expect(isFadedStep(s, "code")).toBe(true);
  });

  it("an mcu build fades nothing at all", () => {
    const s = spec({ buildClass: "mcu" });
    for (const step of ["idea", "parts", "wiring", "enclosure", "print", "code", "make"] as const) {
      expect(isFadedStep(s, step)).toBe(false);
    }
  });

  it("never fades a step the build is about, and the never-faded steps stay", () => {
    for (const s of [spec({ buildClass: "logic" }), spec({ buildClass: "cad" }), spec()]) {
      expect(isFadedStep(s, "idea")).toBe(false);
      expect(isFadedStep(s, "parts")).toBe(false);
      expect(isFadedStep(s, "make")).toBe(false);
    }
  });

  it("gives a reason key only for a faded step", () => {
    expect(fadedReasonKey(spec({ buildClass: "logic" }), "code")).toBe("fadedLogic");
    expect(fadedReasonKey(spec({ buildClass: "cad" }), "wiring")).toBe("fadedCad");
    expect(fadedReasonKey(spec({ buildClass: "logic" }), "wiring")).toBeNull();
    expect(fadedReasonKey(spec(), "code")).toBeNull();
  });
});

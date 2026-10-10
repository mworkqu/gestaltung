import { describe, expect, it } from "vitest";

import { autoBoard, autoPower, autoSetup } from "./auto-electronics";
import { EMPTY_SPEC, setFact } from "./spec";

const withPower = (v: string | null) => setFact(EMPTY_SPEC, { id: "power", label: "Power" }, v);

describe("board and power chosen for the client", () => {
  it("board: the saved route, else the prototype board", () => {
    expect(autoBoard(null)).toBe("prototype");
    expect(autoBoard(undefined)).toBe("prototype");
    expect(autoBoard("prototype")).toBe("prototype");
    expect(autoBoard("custom_pcb")).toBe("custom_pcb");
  });

  it("power: the client's own answer first", () => {
    expect(autoPower(withPower("battery"), "runs from the mains")).toBe("battery");
    expect(autoPower(withPower("solar"), null)).toBe("solar");
  });

  it("power: then what the brief says, then a plug-in adapter", () => {
    expect(autoPower(null, "an off-grid solar monitor")).toBe("solar");
    expect(autoPower(EMPTY_SPEC, "powered by a rechargeable battery")).toBe("battery");
    expect(autoPower(null, "a desk lamp that turns on when I sit")).toBe("mains");
    expect(autoPower(null, null)).toBe("mains");
  });

  it("'not decided yet' (null) falls back, it does not stay empty", () => {
    expect(autoPower(withPower(null), "tiny battery gadget")).toBe("battery");
  });

  it("autoSetup says what still has to be saved", () => {
    const fresh = autoSetup({ route: null, spec: null, brief: "desk lamp" });
    expect(fresh).toEqual({ route: "prototype", needsRoute: true, power: "mains", needsPower: true });
    const done = autoSetup({ route: "prototype", spec: withPower("mains"), brief: "desk lamp" });
    expect(done.needsRoute).toBe(false);
    expect(done.needsPower).toBe(false);
    const custom = autoSetup({ route: "custom_pcb", spec: null, brief: "" });
    expect(custom.route).toBe("custom_pcb");
    expect(custom.needsRoute).toBe(false);
  });
});

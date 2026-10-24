// The QA walk of the live Studio, 2026-10: the rules that refuse what it produced.
//   F-010 the generated firmware read the soil probe backwards, ran the pump with no limit and
//         said nothing about the one feature it could not build;
//   F-011 the understanding card promised a tank sensor no part can be;
//   F-012 a long brief grew features nobody asked for;
//   F-046 an unstocked battery was chosen over a stocked one.

import { describe, expect, it } from "vitest";
import {
  LOAD_MAX_ON_PER_HOUR_MS,
  LOAD_MAX_RUN_MS,
  ensureMissingNote,
  ensureRunGuard,
  hasMissingNote,
  hasRunGuard,
  needsRunGuard,
} from "@/lib/prototyping/firmware";
import { buildConnections, pinBlock, pinConstants, readingNotes } from "./connections";
import { featuresBlockedBy, promiseLine, unmetPromises } from "./card-parts";
import { stepDone } from "./client/steps";
import { getPart, libraryIndexForAI } from "./library";
import { buildWiring } from "./netlist";
import { EQUIVALENT_GROUPS, SOURCED_REASON, enforcePick } from "./ai/pick";
import { guardSpec } from "./ai/spec-guards";
import { clampSpec, emptyStudioDoc, type ProductSpec, type StudioDoc } from "./schema";
import { PLANT_WATERER, PLANT_WATERER_BRIEF, PLANT_WATERER_CARD } from "./__fixtures__/plant-waterer";

const stockOf = (id: string) => (getPart(id)?.storeSkus.length ?? 0) > 0;
const pick = (spec: ProductSpec, partIds: string[], opts: { stock?: boolean } = {}) =>
  enforcePick(
    { components: partIds.map((partId) => ({ partId })) },
    {
      spec,
      index: libraryIndexForAI(),
      locale: "en",
      log: [],
      nameFor: (id) => getPart(id)?.name.en,
      pinsOf: (id) => getPart(id)?.pins,
      ...(opts.stock === false ? {} : { stockOf }),
    },
  );

// ── F-010 ───────────────────────────────────────────────────────────────────

describe("F-010 the generated sketch cannot read a sensor backwards", () => {
  const w = buildWiring(PLANT_WATERER.components, PLANT_WATERER.spec, getPart, "en");
  const connections = buildConnections(w.components, w.netlist.nets, getPart, PLANT_WATERER.spec);
  const constants = pinConstants(connections, getPart);

  it("puts the probe's calibration facts on the library part, not in a prompt", () => {
    const probe = getPart("soil_moisture_cap")!;
    expect(probe.calibration?.note).toMatch(/goes UP as the soil dries/);
    expect(probe.calibration?.constants.map((c) => c.suffix)).toEqual(["DRY_PCT", "WET_PCT"]);
  });

  it("re-inserts them as named constants in the generated pin block", () => {
    const names = constants.filter((c) => c.kind === "reading").map((c) => `${c.name}=${c.value}`);
    expect(names).toEqual(["SOIL_DRY_PCT=70", "SOIL_WET_PCT=45"]);
    const block = pinBlock(constants, readingNotes(connections, getPart));
    expect(block).toContain("const int SOIL_DRY_PCT = 70;");
    expect(block).toContain("// Capacitive soil probe: the reading goes UP as the soil dries out (dry = high, wet = low).");
    // The direction is stated once, above the numbers that depend on it.
    expect(block.indexOf("goes UP")).toBeLessThan(block.indexOf("SOIL_DRY_PCT"));
  });

  it("gives a pump design a max-run guard whatever the model wrote", () => {
    expect(needsRunGuard(w.legacy)).toBe(true);
    const sketch = "#include <Arduino.h>\n\nvoid setup() {}\nvoid loop() {}\n";
    expect(hasRunGuard(sketch)).toBe(false);
    const guarded = ensureRunGuard(sketch, w.legacy);
    expect(guarded.added).toBe(true);
    expect(hasRunGuard(guarded.code)).toBe(true);
    expect(guarded.code).toContain(`const unsigned long LOAD_MAX_RUN_MS = ${LOAD_MAX_RUN_MS}UL;`);
    expect(guarded.code).toContain(`const unsigned long LOAD_MAX_ON_PER_HOUR_MS = ${LOAD_MAX_ON_PER_HOUR_MS}UL;`);
    expect(guarded.code).toContain("bool loadMayRun(unsigned long wantMs)");
    // Idempotent: a sketch that already carries the guard is left alone.
    expect(ensureRunGuard(guarded.code, w.legacy)).toEqual({ code: guarded.code, added: false });
    // The guard rejects a run longer than the limit and one hour's worth of short runs.
    expect(guarded.code).toContain("if (wantMs == 0 || wantMs > LOAD_MAX_RUN_MS) return false;");
    expect(guarded.code).toContain("return loadOnMsThisHour + wantMs <= LOAD_MAX_ON_PER_HOUR_MS;");
  });

  it("asks for no guard when nothing is switched", () => {
    const lamp = buildWiring(
      [{ partId: "esp32_c3_mini", instanceId: "esp32_c3_mini_1", label: "Board" }, { partId: "ws2812_ring", instanceId: "ws2812_ring_1", label: "Ring" }],
      PLANT_WATERER.spec,
      getPart,
      "en",
    );
    expect(needsRunGuard(lamp.legacy)).toBe(false);
    expect(ensureRunGuard("void loop() {}", lamp.legacy).added).toBe(false);
  });

  it("states a feature the parts cannot deliver, in the sketch", () => {
    const unmet = unmetPromises(PLANT_WATERER_CARD, (id) => !!getPart(id));
    expect(unmet.map(promiseLine)).toEqual(["Float switch — detects when the tank is empty"]);
    const features = featuresBlockedBy(PLANT_WATERER_CARD, unmet);
    expect(features).toEqual(["Tank empty light"]);
    const out = ensureMissingNote("void loop() {}", [...features, ...unmet.map(promiseLine)]);
    expect(out.added).toBe(true);
    expect(hasMissingNote(out.code)).toBe(true);
    expect(out.code).toContain("//   - Tank empty light");
    expect(out.code).toContain("//   - Float switch — detects when the tank is empty");
    expect(out.code).toContain("need a part that is");
    // Nothing promised we cannot build → no note at all.
    expect(ensureMissingNote("void loop() {}", [])).toEqual({ code: "void loop() {}", added: false });
  });
});

// ── F-011 ───────────────────────────────────────────────────────────────────

describe("F-011 every Includes line must map to a part", () => {
  const doc = (spec: ProductSpec, partIds: string[]): StudioDoc => ({
    ...emptyStudioDoc(spec),
    components: partIds.map((partId) => ({ partId, instanceId: `${partId}_1`, label: partId })),
  });

  it("reports the tester's tank promise, and the Parts step is not done", () => {
    const parts = pick(PLANT_WATERER_CARD, ["esp32_c3_mini", "soil_moisture_cap", "pump_5v"]).components.map((c) => c.partId);
    expect(unmetPromises(PLANT_WATERER_CARD).map((p) => p.name)).toEqual(["Float switch"]);
    expect(stepDone("parts", doc(PLANT_WATERER_CARD, parts))).toBe(false);
  });

  it("is done once the card only promises parts we have", () => {
    const u = PLANT_WATERER_CARD.understanding!;
    const spec = clampSpec({ ...PLANT_WATERER_CARD, understanding: { ...u, sensors: [u.sensors[0]] } });
    expect(unmetPromises(spec)).toEqual([]);
    expect(stepDone("parts", doc(spec, ["esp32_c3_mini", "soil_moisture_cap", "pump_5v"]))).toBe(true);
  });

  it("leaves a card with no understanding alone (older projects)", () => {
    expect(unmetPromises(PLANT_WATERER.spec)).toEqual([]);
    expect(stepDone("parts", doc(PLANT_WATERER.spec, ["esp32_c3_mini"]))).toBe(true);
  });

  it("counts a promise whose part is missing from THIS library as unmet", () => {
    expect(unmetPromises(PLANT_WATERER_CARD, (id) => id !== "soil_moisture_cap").map((p) => p.name)).toEqual([
      "Soil moisture sensor",
      "Float switch",
    ]);
  });
});

// ── F-012 ───────────────────────────────────────────────────────────────────

describe("F-012 features the visitor never asked for", () => {
  const ctx = { idea: PLANT_WATERER_BRIEF, messages: [], locale: "en" as const };

  it("drops the tester's invented features and keeps what the brief asked for", () => {
    const { spec } = guardSpec(PLANT_WATERER_CARD, ctx);
    expect(spec.features).not.toContain("Motion sensor");
    expect(spec.features).not.toContain("Shows information on a small screen");
    expect(spec.features).toContain("Tank empty light");
    expect(spec.features).toContain("Soil moisture sensing");
  });

  it("reads the whole conversation, not just the last message", () => {
    const asked = guardSpec(PLANT_WATERER_CARD, {
      idea: PLANT_WATERER_BRIEF,
      messages: [
        { role: "user", text: "it should also beep when the tank runs out" },
        { role: "assistant", text: "Done." },
        { role: "user", text: "make it a bit smaller" },
      ],
      locale: "en",
    });
    const withBuzzer = guardSpec({ ...PLANT_WATERER_CARD, features: ["Beeps when the tank is empty"] }, {
      idea: PLANT_WATERER_BRIEF,
      messages: [{ role: "user", text: "it should also beep when the tank runs out" }, { role: "assistant", text: "Done." }, { role: "user", text: "make it a bit smaller" }],
      locale: "en",
    });
    expect(withBuzzer.spec.features).toContain("Beeps when the tank is empty");
    expect(asked.spec.features).not.toContain("Motion sensor");
  });

  it("keeps a feature the visitor said yes to in chat", () => {
    const { spec } = guardSpec({ ...PLANT_WATERER_CARD, features: ["Shows information on a small screen"] }, {
      idea: PLANT_WATERER_BRIEF,
      messages: [
        { role: "assistant", text: "Would you like a small screen that shows the soil reading?" },
        { role: "user", text: "yes please" },
      ],
      locale: "en",
    });
    expect(spec.features).toContain("Shows information on a small screen");
  });

  it("keeps what is already on the card: only NEW lines are judged", () => {
    const current = clampSpec({ ...PLANT_WATERER_CARD, features: ["Motion sensor"] });
    const { spec } = guardSpec({ ...current, features: ["Motion sensor", "Shows information on a small screen"] }, { ...ctx, current });
    expect(spec.features).toContain("Motion sensor");
    expect(spec.features).not.toContain("Shows information on a small screen");
  });

  it("keeps a line that names no function we know of", () => {
    const { spec } = guardSpec({ ...PLANT_WATERER_CARD, features: ["Quiet operation"] }, ctx);
    expect(spec.features).toContain("Quiet operation");
  });

  it("logs every drop", () => {
    const log: { path: string }[] = [];
    guardSpec(PLANT_WATERER_CARD, ctx, log as never);
    expect(log.some((l) => l.path === "features.notAsked")).toBe(true);
  });
});

// ── F-046 ───────────────────────────────────────────────────────────────────

describe("F-046 an in-stock part beats one we would have to source", () => {
  const battery = clampSpec({ ...PLANT_WATERER.spec, power: "battery_usb" });

  it("swaps the unstocked LiPo for the stocked cell the model could have had", () => {
    expect(stockOf("lipo_1000")).toBe(false);
    expect(stockOf("cell_18650")).toBe(true);
    const ids = pick(battery, ["esp32_c3_mini", "lipo_1000", "tp4056_usbc"]).components.map((c) => c.partId);
    expect(ids).toContain("cell_18650");
    expect(ids).not.toContain("lipo_1000");
  });

  it("logs the swap and never swaps outside the hand-checked groups", () => {
    const log: { path: string; from: unknown; to: unknown }[] = [];
    enforcePick(
      { components: [{ partId: "esp32_c3_mini" }, { partId: "lipo_1000" }, { partId: "tp4056_usbc" }] },
      { spec: battery, index: libraryIndexForAI(), locale: "en", log: log as never, nameFor: (id) => getPart(id)?.name.en, stockOf },
    );
    expect(log).toContainEqual({ path: "components.stock", from: "lipo_1000", to: "cell_18650" });
    for (const g of EQUIVALENT_GROUPS) {
      // Every group is a real pair of library parts of the same category.
      const cats = new Set(g.map((id) => getPart(id)?.category));
      expect(g.every((id) => !!getPart(id))).toBe(true);
      expect(cats.size).toBe(1);
    }
  });

  it("says why when it cannot prefer a stocked part", () => {
    // The MG996R servo has no store product and no stocked equivalent of its own.
    const arm = clampSpec({ ...PLANT_WATERER.spec, actuators: [{ kind: "servo", count: 1, load: "heavy" }] });
    const picked = pick(arm, ["esp32_c3_mini", "mg996r_servo"]).components;
    const servo = picked.find((c) => c.partId === "mg996r_servo");
    expect(servo).toBeDefined();
    expect(servo?.reason).toBe(SOURCED_REASON.en);
  });

  it("does nothing without a stock signal (the model's list stands)", () => {
    const ids = pick(battery, ["esp32_c3_mini", "lipo_1000", "tp4056_usbc"], { stock: false }).components.map((c) => c.partId);
    expect(ids).toContain("lipo_1000");
  });
});

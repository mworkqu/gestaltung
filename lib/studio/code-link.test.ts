import { describe, expect, it } from "vitest";
import { buildConnections, pinConstants, PIN_BLOCK_END, PIN_BLOCK_START } from "./connections";
import { constantFor, focusLines, hasPinBlock, lineLinks, pinDiffLines, syncPinBlock } from "./code-link";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import { DEFAULT_SPEC } from "./schema";

const comps = (...ids: string[]) => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
const wiring = (...ids: string[]) => {
  const w = buildWiring(comps(...ids), DEFAULT_SPEC, getPart, "en");
  return buildConnections(w.components, w.netlist.nets, getPart);
};

const USER_CODE = [
  "#include <Arduino.h>",
  "",
  "// my own settings",
  "int threshold = 300;",
  "",
  "void setup() {",
  "  pinMode(LED_PIN, OUTPUT);",
  "  pinMode(BUTTON_PIN, INPUT_PULLUP);",
  "}",
  "",
  "void loop() {",
  "  digitalWrite(LED_PIN, digitalRead(BUTTON_PIN) == LOW);",
  "}",
].join("\n");

describe("syncPinBlock", () => {
  const uno = wiring("arduino_uno", "led_5mm", "button_6mm");
  it("adds the block after the includes and keeps the rest", () => {
    const r = syncPinBlock(USER_CODE, uno, getPart);
    expect(r.changed).toBe(true);
    expect(hasPinBlock(r.code)).toBe(true);
    const lines = r.code.split("\n");
    expect(lines[0]).toBe("#include <Arduino.h>");
    expect(lines.indexOf(PIN_BLOCK_START)).toBe(2);
    // Every original line is still there, in order.
    const rest = lines.filter((l) => !l.startsWith("const int ") && l !== PIN_BLOCK_START && l !== PIN_BLOCK_END);
    expect(rest.filter(Boolean)).toEqual(USER_CODE.split("\n").filter(Boolean));
    expect(r.added.some((l) => l.startsWith("const int LED_PIN = 2;"))).toBe(true);
    expect(r.removed).toEqual([]);
  });
  it("is idempotent", () => {
    const once = syncPinBlock(USER_CODE, uno, getPart).code;
    expect(syncPinBlock(once, uno, getPart).changed).toBe(false);
  });
  it("only touches the block when a pin moves", () => {
    const once = syncPinBlock(USER_CODE, uno, getPart).code.replace("const int LED_PIN = 2;", "const int LED_PIN = 7;");
    const edited = once.replace("int threshold = 300;", "int threshold = 512; // tuned");
    const r = syncPinBlock(edited, uno, getPart);
    expect(r.changed).toBe(true);
    expect(r.code).toContain("int threshold = 512; // tuned");
    expect(r.code).toContain("const int LED_PIN = 2;");
    expect(r.removed.some((l) => l.includes("LED_PIN = 7"))).toBe(true);
    expect(pinDiffLines(r.removed, r.added)).toEqual([
      { kind: "removed", text: "const int LED_PIN = 7;" },
      { kind: "added", text: "const int LED_PIN = 2;" },
    ]);
  });
  it("adds nothing when there are no signal pins and no block", () => {
    const r = syncPinBlock("void setup() {}", [], getPart);
    expect(r).toMatchObject({ changed: false, code: "void setup() {}" });
  });
});

describe("line links", () => {
  const conns = wiring("esp32_devkit", "led_5mm", "dht22", "usbc_power_5v");
  const constants = pinConstants(conns, getPart);
  const code = syncPinBlock(
    ["void setup() {", "  pinMode(LED_PIN, OUTPUT);", "}", "void loop() {", "  float t = read(DHT22_PIN);", "}"].join("\n"),
    conns,
    getPart,
  ).code;
  it("maps declaration and use lines to the wire", () => {
    const links = lineLinks(code, constants);
    const led = constants.find((c) => c.name === "LED_PIN")!;
    const ledLines = [...links.entries()].filter(([, l]) => l.name === "LED_PIN");
    expect(ledLines.length).toBe(2);
    expect(ledLines.filter(([, l]) => l.declares)).toHaveLength(1);
    expect(ledLines.every(([, l]) => l.connectionId === led.connectionIds[0])).toBe(true);
    expect(focusLines(code, led.connectionIds[0], constants)).toEqual(ledLines.map(([i]) => i));
  });
  it("power and ground wires have no constant", () => {
    const ground = conns.find((c) => c.role === "ground")!;
    expect(constantFor(ground.id, constants)).toBeUndefined();
    expect(focusLines(code, ground.id, constants)).toEqual([]);
  });
});

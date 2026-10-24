import { describe, expect, it } from "vitest";

import { boardDisplayName, looksLikeFqbn } from "./board-name";

describe("boardDisplayName (F-045)", () => {
  it("uses the library part's name instead of the FQBN", () => {
    expect(boardDisplayName("arduino:avr:nano", "Arduino Nano")).toBe("Arduino Nano");
  });
  it("keeps a human board name the model already wrote", () => {
    expect(boardDisplayName("Arduino Uno R3", "Arduino Uno")).toBe("Arduino Uno R3");
  });
  it("falls back to the part name when nothing is stored", () => {
    expect(boardDisplayName("", "ESP32 DevKit")).toBe("ESP32 DevKit");
    expect(boardDisplayName(undefined, null)).toBe("");
  });
  it("makes a readable name from an FQBN with no library part", () => {
    expect(boardDisplayName("arduino:avr:nano_every", undefined)).toBe("Nano Every");
    expect(boardDisplayName("esp32:esp32:esp32doit-devkit-v1", "")).toBe("Esp32doit Devkit V1");
  });
  it("recognises FQBNs only", () => {
    expect(looksLikeFqbn("arduino:avr:nano")).toBe(true);
    expect(looksLikeFqbn("arduino:avr:nano:cpu=atmega328old")).toBe(true);
    expect(looksLikeFqbn("Arduino Nano")).toBe(false);
  });
});

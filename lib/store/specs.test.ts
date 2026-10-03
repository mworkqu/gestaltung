import { describe, expect, it } from "vitest";

import { productSpecs, splitSpecs } from "./specs";

const voltaat = "Fast thruster.\nFeatures\n• Brushless\nSpecifications\n• Motor type: Brushless DC motor\n• Operating voltage: 7–24V DC\nLinks\n• 3D model";

describe("splitSpecs", () => {
  it("lifts the Specifications bullets out of a Voltaat description", () => {
    const r = splitSpecs(voltaat);
    expect(r.specs).toEqual([
      { name: "Motor type", value: "Brushless DC motor" },
      { name: "Operating voltage", value: "7–24V DC" },
    ]);
    expect(r.text).toContain("Features");
    expect(r.text).not.toContain("Operating voltage");
    expect(r.text).toContain("Links");
  });
  it("leaves a description without a spec section alone", () => {
    expect(splitSpecs("Just text")).toEqual({ text: "Just text", specs: [] });
  });
});

describe("productSpecs", () => {
  it("prefers the supplier's table", () => {
    const r = productSpecs({ specs: [{ name: "Voltage", value: "5V" }], description: voltaat });
    expect(r.specs).toEqual([{ name: "Voltage", value: "5V" }]);
    expect(r.text).toBe(voltaat);
  });
});

import { tidyDescription } from "./specs";

describe("tidyDescription", () => {
  it("drops the repeated title and a Links section with no URL", () => {
    const r = tidyDescription("L298N Motor Driver\nDrives two motors.\nLinks\n• 3D Model\nTutorials\n• Wiring", ["L298N Motor Driver"]);
    expect(r.links).toEqual([]);
    expect(r.text).toBe("Drives two motors.\nTutorials\n• Wiring");
  });
  it("matches the title ignoring case and punctuation", () => {
    expect(tidyDescription("l298n  motor driver:\nBody", ["L298N Motor Driver"]).text).toBe("Body");
  });
  it("keeps a Links entry that has a URL as a real link", () => {
    const r = tidyDescription("Body\nLinks\n• 3D Model https://example.com/model.step\n• Datasheet", []);
    expect(r.links).toEqual([{ label: "3D Model", url: "https://example.com/model.step" }]);
    expect(r.text).toBe("Body");
  });
  it("reads a one-line Links entry and uses the host when there is no label", () => {
    expect(tidyDescription("Body\nLinks • https://www.example.com/a", []).links).toEqual([
      { label: "example.com", url: "https://www.example.com/a" },
    ]);
    expect(tidyDescription("Links • 3D Model", []).text).toBeNull();
  });
  it("does not touch ordinary text that merely starts with Links", () => {
    expect(tidyDescription("Links-based design", []).text).toBe("Links-based design");
  });
});

import { describe, expect, it } from "vitest";

import { humanPartName, partsForList, type PartSource } from "./parts";

describe("humanPartName (audit #34)", () => {
  it("turns an identifier into words", () => {
    expect(humanPartName("monitor_firmware")).toBe("Monitor firmware");
    expect(humanPartName("esp32_ota_updater")).toBe("Esp32 ota updater");
    expect(humanPartName("  pump_driver  ")).toBe("Pump driver");
  });

  it("leaves ordinary names exactly as stored", () => {
    for (const name of [
      "Monitor firmware",
      "Enclosure",
      "firmware", // one word, no underscore
      "Base_plate", // not all lower case: the client typed it
      "sensor_", // not an identifier
      "_sensor",
      "Pump bracket (left)",
      "غلاف الجهاز",
      "",
    ])
      expect(humanPartName(name)).toBe(name);
  });
});

describe("partsForList (audit #34)", () => {
  type P = { id: string; source: PartSource | null; status: string };
  const parts: P[] = [
    { id: "concept", source: "to_design", status: "suggested" },
    { id: "kept", source: "to_design", status: "confirmed" },
    { id: "edited", source: "to_design", status: "edited" },
    { id: "added", source: "to_design", status: "added" },
    { id: "legacy-concept", source: null, status: "suggested" }, // rows from before 0022
    { id: "catalog", source: "catalog", status: "suggested" }, // a catalog pick is never a concept
  ];

  it("hides concepts until they are kept", () => {
    expect(partsForList(parts).map((p) => p.id)).toEqual(["kept", "edited", "added", "catalog"]);
  });

  it("keeps the original rows and order", () => {
    const shown = partsForList(parts);
    expect(shown[0]).toBe(parts[1]);
  });
});

import { describe, expect, it } from "vitest";

import { humanName, humanPartName, titleCaseId } from "./human-name";
import { projectReadiness } from "./readiness";

describe("titleCaseId", () => {
  it("title-cases a snake_case id", () => {
    expect(titleCaseId("plant_monitor_enclosure")).toBe("Plant Monitor Enclosure");
    expect(titleCaseId("  soil-sensor  ")).toBe("Soil Sensor");
  });
});

describe("humanName (P0-07)", () => {
  it("uses the part's name, turning an identifier name into words", () => {
    expect(humanName("Plant monitor enclosure", "plant_monitor_enclosure")).toBe("Plant monitor enclosure");
    expect(humanName("plant_monitor_enclosure", "x")).toBe(humanPartName("plant_monitor_enclosure"));
    expect(humanName("plant_monitor_enclosure")).toBe("Plant monitor enclosure");
  });
  it("falls back to a Title Case of the id when there is no name", () => {
    expect(humanName("", "plant_monitor_enclosure")).toBe("Plant Monitor Enclosure");
    expect(humanName("   ", "plant_monitor_enclosure")).toBe("Plant Monitor Enclosure");
    expect(humanName(null, "soil_sensor")).toBe("Soil Sensor");
    expect(humanName(undefined, undefined)).toBe("");
  });
});

describe("readiness labels carry no raw concept ids (P0-07)", () => {
  it("a part named with a snake_case id reads as words in its label and reason", () => {
    const r = projectReadiness(
      {
        brief: "A plant monitor that waters the plant when the soil is dry and shows its state on four LEDs.",
        spec: null,
        routeAccepted: false,
        parts: [
          { id: "p1", code: "P-01", name: "plant_monitor_enclosure", status: "added", material: null, process: null, kind: "mechanical", source: "to_design" },
        ],
      },
      (k, p) => (p?.name ? `${k}|${p.name}` : k)
    );
    const req = r.requirements.find((x) => x.id === "part:p1")!;
    expect(req.label).toBe("P-01 Plant monitor enclosure");
    expect(req.blockingReason).toContain("Plant monitor enclosure");
    expect(JSON.stringify(r.requirements)).not.toContain("plant_monitor_enclosure");
  });
});
